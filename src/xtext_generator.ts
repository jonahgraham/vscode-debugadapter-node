/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as fs from 'fs';
import {IProtocol, Protocol as P} from './json_schema';

var hashCodeCounter = 1;
function Module(schema: IProtocol, version: string): string[] {
	let header = '';
	header += line('/******************************************************************************');
	header += line(' * Copyright (c) 2017, 2020 Kichwa Coders Ltd. and others.');
	header += line(' *');
	header += line(' * This program and the accompanying materials are made available under the');
	header += line(' * terms of the Eclipse Public License v. 2.0 which is available at');
	header += line(' * http://www.eclipse.org/legal/epl-2.0,');
	header += line(' * or the Eclipse Distribution License v. 1.0 which is available at');
	header += line(' * http://www.eclipse.org/org/documents/edl-v10.php.');
	header += line(' *');
	header += line(' * SPDX-License-Identifier: EPL-2.0 OR BSD-3-Clause');
	header += line(' ******************************************************************************/');
	header += line();

	// We use Organize Includes in Eclipse to sort and import everything we need, we just
	// explicitly list the ones here that tend to cause conflicts/questions.

	let protocol = header;
	let client = header;
	let server = header;

	protocol += line("package org.eclipse.lsp4j.debug;")
	protocol += line();
	protocol += line("import com.google.gson.annotations.SerializedName");
	protocol += line("import java.util.Map");
	protocol += line("import org.eclipse.lsp4j.generator.JsonRpcData");
	protocol += line("import org.eclipse.lsp4j.jsonrpc.messages.Either");
	protocol += line("import org.eclipse.lsp4j.jsonrpc.validation.NonNull");
	protocol += line();
	protocol += comment({ description : `Declaration of parameters, response bodies, and event bodies.\nAuto-generated from debugProtocol.json schema version ${version}. Do not edit manually.`});

	client += line("package org.eclipse.lsp4j.debug.services;")
	client += line();
	client += comment({ description : `Declaration of client notifications.\nAuto-generated from debugProtocol.json schema version ${version}. Do not edit manually.`});
	client += openBlock(`public interface IDebugProtocolClient`);

	server += line("package org.eclipse.lsp4j.debug.services;")
	server += line();
	server += comment({ description : `Declaration of server requests.\nAuto-generated from debugProtocol.json schema version ${version}. Do not edit manually.`});
	server += openBlock(`public interface IDebugProtocolServer`);

	protocol += line(`class DebugProtocol {`)
	protocol += comment({ description : `Version of debugProtocol.json this class was derived from.` });
	protocol += line(`public static final String SCHEMA_VERSION = "${version}";`);
	protocol += line(`}`)
	client += comment({ description : `Version of debugProtocol.json this class was derived from.` });
	client += line(`public static final String SCHEMA_VERSION = "${version}";`);
	server += comment({ description : `Version of debugProtocol.json this class was derived from.` });
	server += line(`public static final String SCHEMA_VERSION = "${version}";`);


	for (let typeName in schema.definitions) {
		if (["ProtocolMessage", "Request", "Event", "Response"].indexOf(typeName) > -1) {
			// The lowest level protocol message are defined in Java already in the jsonrpc plug-in
			continue
		}

		const d2 = schema.definitions[typeName];
		let supertype: string = null;
		if ((<P.AllOf>d2).allOf) {
			const array = (<P.AllOf>d2).allOf;
			for (let d of array) {
				if ((<P.RefType>d).$ref) {
					supertype = getRef((<P.RefType>d).$ref);
				} else {
					if (supertype === "Event") {
						let [p, c] = EventInterface(typeName, <P.Definition> d);
						protocol += p
						client += c
					} else if (supertype === "Request") {
						let request = d;
						let responseName = typeName.replace(/Request/, 'Response')
						let responseDef = schema.definitions[responseName]
						let responseProps = (<P.AllOf>responseDef).allOf[1]
						let [p, s] = RequestInterface(typeName, <P.Definition> d, <P.Definition>responseProps);
						protocol += p
						server += s
					} else if (supertype === "Response") {
						// skip it here, it was dealt with in the Request phase
					} else {
						protocol += ProtocolInterface(typeName, <P.Definition> d, supertype);
					}
				}
			}
		} else {
			if ((<P.StringType>d2).enum) {
				protocol += ClosedEnum(typeName, <P.StringType> d2);
			} else {
				protocol += ProtocolInterface(typeName, <P.Definition> d2);
			}
		}
	}

	protocol += line();
	client += closeBlock() + line();
	server += closeBlock() + line();

	return [protocol, client, server];
}

function JavaSafe(str: string): string {
	if (["class", "continue", "default", "enum", "goto", "interface"].indexOf(str) > -1) {
		return str + "_";
	}
	return str;
}

function CamelCaseToUpperCase(str: string): (string | boolean)[] {
	if (/[a-z]/.test(str)) {
		let result = str.replace( /([A-Z])/g, "_$1" ).toUpperCase();
		result = result.replace( / /g, "_" );
		// XXX: Special case some values rather than write a complete converter
		if (result.indexOf('U_T_C') > -1) {
			result = result.replace('U_T_C', 'UTC');
			return [result, true];
		} else {
			return [result, false];
		}
	} else {
		return [str, true];
	}
}

function ProtocolBody(interfaceName: string, str: string, definition: P.Definition, superType?: string): string {
	let s = openBlock(str);
	let extra = '';

	for (let propName in definition.properties) {
		const required = definition.required ? definition.required.indexOf(propName) >= 0 : false;
		let [p, e] = property(interfaceName, propName, !required, definition.properties[propName], true);
		s += p;
		extra += e;
	}
	s += closeBlock();
	s += extra;
	return s;
}

function RequestInterface(interfaceName: string, request: P.Definition, response: P.Definition): string[] {
	let commandName = request.properties.command["enum"][0]
	let body = request.properties.body

	let protocol = ''

	let returnTypeName = 'Void'
	if (response.properties && response.properties.body) {
		let responseBody = response.properties.body;
		returnTypeName = `${interfaceName.replace(/Request/, 'Response')}`
		let [resolvedTypeName, unused] = propertyType(responseBody, returnTypeName);
		if (resolvedTypeName === returnTypeName) {
			protocol += line();
			protocol += comment({ description : response.description });
				let x = `@JsonRpcData\nclass ${resolvedTypeName}`;
			protocol += ProtocolBody(returnTypeName, x, <P.Definition>responseBody)
		}
		returnTypeName = resolvedTypeName;
	}

	let argsTypeName = undefined;
	if (request.properties.arguments) {
		argsTypeName = propertyType(request.properties.arguments)[0];
	}
	// Some special cases that the schema does not show
	if (argsTypeName === 'LaunchRequestArguments' || argsTypeName === 'AttachRequestArguments') {
		// Launch/attach request arguments can actually be any of the arbitrary json
		// that is in launch.json file.
		argsTypeName = 'Map<String, Object>';
	}


	let server = line();
	server += comment({ description : request.description });
	let javaSafeName = JavaSafe(commandName);
	if (javaSafeName != commandName) {
		server += line(`@JsonRequest(value = "${commandName}")`)
	} else {
		server += line(`@JsonRequest`)
	}
	server += `default CompletableFuture<${returnTypeName}> ${javaSafeName}`;
	if (argsTypeName) {
		server += `(${argsTypeName} args) { throw new UnsupportedOperationException(); }`;
	} else {
		server += `() { throw new UnsupportedOperationException(); }`;
	}

	return [protocol, server];
}

function EventInterface(interfaceName: string, definition: P.Definition): string[] {
	let eventName = definition.properties.event["enum"][0]
	let body = definition.properties.body

	let protocol = ''
	let paramType = ''
	if (body) {
		protocol += line();
		protocol += comment({ description : definition.description });
		paramType = `${interfaceName}Arguments`
		let x = `@JsonRpcData\nclass ${paramType}`;
		protocol += ProtocolBody(paramType, x, <P.Definition>body)
	}

	let client = line();
	client += comment({ description : definition.description });
	let javaSafeName = JavaSafe(eventName);
	if (javaSafeName != eventName) {
		client += line(`@JsonNotification(value = "${eventName}")`)
	} else {
		client += line(`@JsonNotification`)
	}
	client += `default void ${javaSafeName}`;
	if (paramType) {
		client += `(${paramType} args){}`;
	} else {
		client += `(){}`;
	}

	return [protocol, client];
}

function ProtocolInterface(interfaceName: string, definition: P.Definition, superType?: string): string {

	let s = line();

	s += comment({ description : definition.description });

	let x = `@JsonRpcData\nclass ${interfaceName}`;
	if (superType) {
		x += ` extends ${superType}`;
	}
	s += ProtocolBody(interfaceName, x, definition, superType);

	return s;
}

function ClosedEnum(typeName: string, definition: P.StringType): string {
	let s = line();
	s += comment(definition);
	s += line(`enum ${typeName} {`);
	for (let i = 0; i < definition.enum.length; i++) {
		if (i != 0) {
			s += `,\n`;
		}
		let desc = ''
		if (definition.enumDescriptions) {
			desc = `/**\n * ${wrap(definition.enumDescriptions[i])}\n*/\n`;
		}
		let [enumName, needsSerializedName] = CamelCaseToUpperCase(definition.enum[i]);
		let serializedName = '';
		if (needsSerializedName) {
			serializedName = `@SerializedName("${definition.enum[i]}")\n\t`;
		}
		s += `${desc}${serializedName}${enumName}`
	}
	s += line(`}`);
	return s;
}

function OpenEnum(typeName: string, definition: P.StringType): string {
	let s = line();
	s += comment(definition, false, typeName);
	s += line(`interface ${typeName} {`);
	for (let i = 0; i < definition._enum.length; i++) {
		let desc = ''
		if (definition.enumDescriptions) {
			desc = `/**\n * ${wrap(definition.enumDescriptions[i])}\n*/\n`;
		}
		s += `${desc}public static final String ${CamelCaseToUpperCase(definition._enum[i])[0]} = "${definition._enum[i]}";\n`
	}
	s += line(`}`);
	return s;
}

function wrap(l: string): string {
	const maxLength = 110; // 120 - indent amount
	if (l.length > maxLength) {
		let words = l.split(' ');
		let lineLength = 0
		l = '';
		for (let w of words) {
			if (lineLength + w.length > maxLength) {
				l += '\n';
				lineLength = 0;
			} else if (lineLength > 0) {
				l += ' ';
				lineLength += 1;
			}
			l += w;
			lineLength += w.length;
		}
	}
	return l;
}

function comment(c: P.Commentable, optional ?: boolean, typeName ?: string): string {

	let description = '';

	let rawDescription = c.description || '';

	let inList = false;
	let first = true;
	let lines = rawDescription.split(/\n/)
	for (let l of lines) {
		l = wrap(l);
		if (l.startsWith('- ')) {
			if (!inList) {
				inList = true;
				description += line('<ul>');
			}
			l = l.substring(2);
			description += line(`<li>${l}</li>`)
		} else {
			if (inList) {
				inList = false;
				description += line('</ul>');
			}
			if (!first) {
				description += line(`<p>`);
			}
			description += line(`${l}`)
		}
		first = false;
	}
	if (inList) {
		description += line('</ul>');
	}

	if (optional) {
		description += line('<p>\nThis is an optional property.');
	}

	if ((<any>c).items) {	// array
		c = (<any>c).items;
	}

	// a 'closed' enum with individual descriptions is javadoc'd in the Enum method

	// an 'open' enum is stored in a String with suggested/possible values
	if (c._enum) {
		description += `<p>\n${wrap(`Possible values include - but not limited to those defined in {@link ${typeName}}`)}\n`;
	}

	if (description) {
		return line(`/**\n${description}*/`);
	}
	return '';
}

function openBlock(str: string, openChar?: string): string {
	openChar = openChar || ' {';
	let s = line(`${str}${openChar}`, true);
	return s;
}

function closeBlock(closeChar?: string, newline?: boolean): string {
	newline = typeof newline === 'boolean' ? newline : true;
	closeChar = closeChar || '}';
	return line(closeChar, newline);
}

function propertyType(prop: any, name?: string, optional?: boolean): string[] {
	let nonnull = optional ? '' : line('@NonNull');
	if (prop.$ref) {
		return [getRef(prop.$ref), '', nonnull];
	}
	switch (prop.type) {
		case 'array':
			const [t, extra] = propertyType(prop.items, name);
			return [`${t}[]`, extra, nonnull];
		case 'object':
			return [objectType(prop, name), '', nonnull];
		case 'string':
			if (prop.enum) {
				return [name, ClosedEnum(name, prop), nonnull];
			}
			if (prop._enum) {
				return ['String', OpenEnum(name, prop), nonnull];
			}
			return [`String`, '', nonnull];
		case 'integer':
			if (optional) {
				return ['Integer', '', nonnull];
			} else {
				return ['int', '', ''];
			}
		case 'number':
			if (optional) {
				return ['Double', '', nonnull];
			} else {
				return ['double', '', ''];
			}
		case 'boolean':
			if (optional) {
				return ['Boolean', '', nonnull];
			} else {
				return ['boolean', '', ''];
			}
	}
	if (Array.isArray(prop.type)) {
		function eitherType(v: string) {
			switch (v) {
				case 'array':
				case 'object':
				case 'boolean':
					return 'Boolean';
				case 'integer':
				case 'number':
					return 'Integer';
				case 'string':
					return 'String';
				case 'null':
					return 'null';
			}
		}
		let types = prop.type.map(v => eitherType(v));
		if (types.indexOf('null') > -1) {
			// Despite possibly being declared required, is actually possible to be null
			nonnull = '';
		}
		types = types.filter((v, i, a) => v !== 'null')
		types = types.filter((v, i, a) => a.indexOf(v) === i);
		if (types.indexOf('Object') > -1) {
			return ['Object', '', nonnull];
		}
		switch (types.length) {
			case 0:
				throw new Error("Unexpected 0 entries");
			case 1:
				return [types[0], '', nonnull];
			case 2:
				return [`Either<${types[0]},${types[1]}>`, '', nonnull];
			case 3:
				return ['Object', '', nonnull];
			default:
				throw new Error(`Need a new Either for ${types.length} types`);
		}
	}
	return [prop.type, '', nonnull];
}

function objectType(prop: any, name?: string): string {
	if (prop.properties) {
		return name;
	}
	if (prop.additionalProperties) {
		return 'Map<String, String>';
	}
	return '{}';
}

function capatilize(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

function property(enclosingType: string, name: string, optional: boolean, prop: P.PropertyType, isProtocol: boolean): string[] {
	let s = '';
	let enumName = enclosingType + capatilize(name);
	const [type, extra, nonnull] = propertyType(prop, enumName, optional);
	s += comment(prop, optional, enumName);
	let javaSafeName = JavaSafe(name);
	if (javaSafeName != name) {
		s += line(`@SerializedName(value = "${name}")`)
	}
	s += nonnull;
	let declPublic = '';
	if (!isProtocol) {
		declPublic = 'public '
	}
	s += line(`${declPublic}${type} ${javaSafeName};`)

	return [s, extra];
}

function getRef(ref: string): string {
	const REXP = /#\/(.+)\/(.+)/;
	const matches = REXP.exec(ref);
	if (matches && matches.length === 3) {
		return matches[2];
	}
	console.log('error: ref');
	return ref;
}

function line(str?: string, newline?: boolean): string {
	newline = typeof newline === 'boolean' ? newline : true;
	let s = '';
	if (str) {
		s += str;
	}
	if (newline) {
		s += '\n';
	}
	return s;
}


/// Main
const debugProtocolSchema = JSON.parse(fs.readFileSync('./debugProtocol.json').toString());
const packageJson = JSON.parse(fs.readFileSync('./protocol/package.json').toString());
const version = packageJson.version;
var [protocol, client, server] = Module(debugProtocolSchema, version);

let javaroot = '../lsp4j/org.eclipse.lsp4j.debug/src/main/java';
if (process.argv.length > 2) {
	javaroot = process.argv[2];
}
fs.writeFileSync(`${javaroot}/org/eclipse/lsp4j/debug/DebugProtocol.xtend`, protocol, { encoding: 'utf-8'});
fs.writeFileSync(`${javaroot}/org/eclipse/lsp4j/debug/services/IDebugProtocolClient.java`, client, { encoding: 'utf-8'});
fs.writeFileSync(`${javaroot}/org/eclipse/lsp4j/debug/services/IDebugProtocolServer.java`, server, { encoding: 'utf-8'});
console.log(`Generation of Debug Protocol java files complete in ${javaroot}.`)
console.log(`Please format and organize imports on the Java files.`)
