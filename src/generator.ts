/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as fs from 'fs';
import {IProtocol, Protocol as P} from './json_schema';

var hashCodeCounter = 1;
function Module(schema: IProtocol, version: string): string[] {

	let header = '';
	header += line('/*******************************************************************************');
	header += line(' * Copyright (c) 2017 Kichwa Coders Ltd. and others.');
	header += line(' * All rights reserved. This program and the accompanying materials');
	header += line(' * are made available under the terms of the Eclipse Public License v1.0');
	header += line(' * which accompanies this distribution, and is available at');
	header += line(' * http://www.eclipse.org/legal/epl-v10.html');
	header += line(' *******************************************************************************/');
	header += line();
	// We use Organize Includes in Eclipse to sort and import everything we need, we just
	// explicitly list the ones here that tend to cause conflicts/questions.

	let protocol = header;
	let client = header;
	let server = header;

	protocol += line("package org.eclipse.lsp4j.debug;")
	protocol += line();
	protocol += comment({ description : `Declaration of parameters, response bodies, and event bodies.\nAuto-generated from debugProtocol.json schema version ${version}. Do not edit manually.`});
	protocol += openBlock(`public class DebugProtocol`);

	client += line("package org.eclipse.lsp4j.debug.services;")
	client += line();
	client += comment({ description : `Declaration of client notifications.\nAuto-generated from debugProtocol.json schema version ${version}. Do not edit manually.`});
	client += openBlock(`public interface IDebugProtocolClient`);

	server += line("package org.eclipse.lsp4j.debug.services;")
	server += line();
	server += comment({ description : `Declaration of server requests.\nAuto-generated from debugProtocol.json schema version ${version}. Do not edit manually.`});
	server += openBlock(`public interface IDebugProtocolServer`);

	protocol += comment({ description : `Version of debugProtocol.json this class was derived from.` });
	protocol += line(`public static final String SCHEMA_VERSION = "${version}";`);
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
						protocol += Interface(typeName, <P.Definition> d, supertype);
					}
				}
			}
		} else {
			if ((<P.StringType>d2).enum) {
				protocol += Enum(typeName, <P.StringType> d2);
			} else {
				protocol += Interface(typeName, <P.Definition> d2);
			}
		}
	}

	protocol += closeBlock() + line();
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

function Body(interfaceName: string, str: string, definition: P.Definition, superType?: string): string {
	let s = openBlock(str);

	for (let propName in definition.properties) {
		const required = definition.required ? definition.required.indexOf(propName) >= 0 : false;
		s += property(interfaceName, propName, !required, definition.properties[propName]);
	}
	s += ToString(interfaceName, definition.properties, superType)
	s += Equals(interfaceName, definition.properties, superType)
	s += HashCode(interfaceName, definition.properties, superType)
	s += closeBlock();
	return s;
}

function ToString(interfaceName : string, properties: { [key: string]: P.PropertyType; }, superType?: string) : string {
	let s = "";
	s += line("@Override");
	s += openBlock("public String toString()");
	if (properties || superType) {
		s += line(`StringBuilder sb = new StringBuilder();`)
		s += line(`sb.append("${interfaceName} [");`)
		let comma = "";
		for (let propName in properties) {
			let safeName = JavaSafe(propName);
			s += line(`sb.append("${comma}${safeName}=");`)
			if (properties[propName].type == 'array') {
				s += line(`sb.append(Arrays.toString(${safeName}));`)
			} else {
				s += line(`sb.append(${safeName});`)
			}
			comma = ', '
		}
		if (superType) {
			s += line(`sb.append("${comma}super=");`)
			s += line(`sb.append(super.toString());`)
		}
		s += line(`sb.append("]");`)
		s += line(`return sb.toString();`)
	} else {
		s += line(`return "${interfaceName} []";`)
	}
	s += closeBlock();
	return s;
}

function Equals(interfaceName : string, properties: { [key: string]: P.PropertyType; }, superType?: string) : string {
	let s = "";
	s += line("@Override");
	s += openBlock("public boolean equals(Object obj)");
	s += line(`if (this == obj) { return true; }`);
	s += line(`if (!super.equals(obj)) { return false; }`);
	s += line(`if (obj == null) { return false; }`);
	s += line(`if (getClass() != obj.getClass()) { return false; }`);
	if (properties) {
		s += line(`${interfaceName} other = (${interfaceName}) obj;`);

		for (let propName in properties) {
			let safeName = JavaSafe(propName);
			if (properties[propName].type == 'array') {
				s += line(`if (!Arrays.equals(${safeName}, other.${safeName})) { return false; }`)
			} else {
				s += line(`if (!Objects.equals(${safeName}, other.${safeName})) { return false; }`)
			}
		}
	}
	s += line(`return true;`)
	s += closeBlock();
	return s;
}

function HashCode(interfaceName : string, properties: { [key: string]: P.PropertyType; }, superType?: string) : string {
	let s = "";
	s += line("@Override");
	s += openBlock("public int hashCode()");
	if (properties) {
		if (superType) {
			s += line(`int result = 31 * super.hashCode() + ${hashCodeCounter};`);
		} else {
			s += line(`int result = ${hashCodeCounter};`);
		}
		for (let propName in properties) {
			let safeName = JavaSafe(propName);
			if (properties[propName].type == 'array') {
				s += line(`result = 31 * result + Arrays.hashCode(${safeName});`)
			} else {
				s += line(`result = 31 * result + Objects.hashCode(${safeName});`)
			}
		}
		s += line(`return result;`);
	} else {
		if (superType) {
			s += line(`int result = 31 * super.hashCode() + ${hashCodeCounter};`);
		} else {
			s += line(`return ${hashCodeCounter};`);
		}
	}
	s += closeBlock();
	hashCodeCounter += 1;
	return s;
}

function RequestInterface(interfaceName: string, request: P.Definition, response: P.Definition): string[] {
	let commandName = request.properties.command["enum"][0]
	let body = request.properties.body

	let protocol = ''

	let returnTypeName = 'Void'
	if (response.properties && response.properties.body) {
		let responseBody = response.properties.body;
		protocol += line();
		protocol += comment({ description : response.description });
		returnTypeName = `${interfaceName.replace(/Request/, 'Response')}`
		let x = `public static class ${returnTypeName}`;
		protocol += Body(returnTypeName, x, <P.Definition>responseBody)
	}

	let argsTypeName = undefined;
	if (request.properties.arguments) {
		argsTypeName = propertyType(request.properties.arguments)[0];
	}
	// Some special cases that the schema does not show
	if (argsTypeName === 'LaunchRequestArguments') {
		// Launch request arguments can actually be any of the arbitrary json
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
		server += `(${argsTypeName} args) {`;
	} else {
		server += `() {`;
	}
	server += `throw new UnsupportedOperationException();`
	server += `}`

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
		let x = `public static class ${paramType}`;
		protocol += Body(paramType, x, <P.Definition>body)
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
		client += `(${paramType} args) {`;
	} else {
		client += `() {`;
	}
	client += `throw new UnsupportedOperationException();`
	client += `}`

	return [protocol, client];
}

function Interface(interfaceName: string, definition: P.Definition, superType?: string): string {

	let s = line();

	s += comment({ description : definition.description });

	let x = `public static class ${interfaceName}`;
	if (superType) {
		x += ` extends ${superType}`;
	}
	s += Body(interfaceName, x, definition, superType);

	return s;
}

function Enum(typeName: string, definition: P.StringType): string {
	let s = line();
	s += comment(definition);
	s += line(`public enum ${typeName} {`);
	for (let i = 0; i < definition.enum.length; i++) {
		if (i != 0) {
			s += `, `;
		}
		let extendedDesc = ''
		if (definition.enumDescriptions) {
			extendedDesc = `<p>${definition.enumDescriptions[i]}</p>`;
		}
		let desc = `${extendedDesc}<p>Encoded value: {@code ${definition.enum[i]}}</p>`
		let [enumName, needsSerializedName] = CamelCaseToUpperCase(definition.enum[i]);
		let serializedName = '';
		if (needsSerializedName) {
			serializedName = `@SerializedName("${definition.enum[i]}")\n`;
		}
		s += `/** ${desc} */\n${serializedName}${enumName}`
	}
	s += line(`}`);
	return s;
}

function OpenEnum(typeName: string, definition: P.StringType): string {
	let s = line();
	s += comment(definition, false, typeName);
	s += line(`public interface ${typeName} {`);
	for (let i = 0; i < definition._enum.length; i++) {
		let extendedDesc = ''
		if (definition.enumDescriptions) {
			extendedDesc = `<p>${definition.enumDescriptions[i]}</p>`;
		}
		let desc = `${extendedDesc}<p>Encoded value: {@code ${definition._enum[i]}}</p>`
		s += `/** ${desc} */ public static final String ${CamelCaseToUpperCase(definition._enum[i])[0]} = "${definition._enum[i]}";\n`
	}
	s += line(`}`);
	return s;
}

function comment(c: P.Commentable, optional ?: boolean, typeName ?: string): string {

	let description = '';

	let rawDescription = c.description || '';

	let inList = false;
	let lines = rawDescription.split(/\n/)
	for (let l of lines) {
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
			description += line(`<p>${l}</p>`)
		}
	}
	if (inList) {
		description += line('</ul>');
	}

	if (optional) {
		description += line('<p>This is an optional property.</p>');
	}

	if ((<any>c).items) {	// array
		c = (<any>c).items;
	}

	// a 'closed' enum with individual descriptions is javadoc'd in the Enum method

	// an 'open' enum is stored in a String with suggested/possible values
	if (c._enum) {
		description += `<p>Possible values include - but not limited to those defined in {@link ${typeName}}</p>\n`;
	}

	if (description) {
		return line(`/** ${description} */`);
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

function propertyType(prop: any, name?: string): string[] {
	if (prop.$ref) {
		return [getRef(prop.$ref), ''];
	}
	switch (prop.type) {
		case 'array':
			const [t, extra] = propertyType(prop.items, name);
			return [`${t}[]`, extra];
		case 'object':
			return [objectType(prop), ''];
		case 'string':
			if (prop.enum) {
				let enumName = capatilize(name);
				return [enumName, Enum(enumName, prop)];
			}
			if (prop._enum) {
				let enumName = capatilize(name);
				return ['String', OpenEnum(enumName, prop)];
			}
			return [`String`, ''];
		case 'integer':
		case 'number':
			// TODO: technically the schema says any kind of number is allowed here,
			// in practice AFAICT this is really an integer all the time
			// the schema also does not put a range on these numbers/integers so
			// presumably the range of int is sufficient
			return ['Integer', ''];
		case 'boolean':
			return ['Boolean', ''];
	}
	if (Array.isArray(prop.type)) {
		function eitherType(v: string) {
			switch (v) {
				case 'array':
				case 'object':
				case 'null':
					return 'Object';
				case 'boolean':
					return 'Boolean';
				case 'integer':
				case 'number':
					return 'Integer';
				case 'string':
					return 'String';
			}
		}
		let types = prop.type.map(v => eitherType(v));
		types = types.filter((v, i, a) => a.indexOf(v) === i);
		if (types.indexOf('Object') > -1) {
			return ['Object', ''];
		}
		switch (types.length) {
			case 0:
				throw new Error("Unexpected 0 entries");
			case 1:
				return [types[0], ''];
			case 2:
				return [`Either<${types[0]},${types[1]}>`, ''];
			case 3:
				return [`Either3<${types[0]},${types[1]},${types[2]}>`, ''];
			default:
				throw new Error(`Need a new Either for ${types.length} types`);
		}
	}
	return [prop.type, ''];
}

function objectType(prop: any): string {
	if (prop.properties) {
		throw new Error("TODO 2: This code was not called when generator was written")
		// let s = openBlock('', '{');

		// for (let propName in prop.properties) {
		// 	const required = prop.required ? prop.required.indexOf(propName) >= 0 : false;
		// 	s += property(enclosing type, propName, !required, prop.properties[propName]);
		// }

		// s += closeBlock('}', false);
		// return s;
	}
	if (prop.additionalProperties) {
		return 'Map<String, String>';
	}
	return '{}';
}

function capatilize(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

function property(enclosingType: string, name: string, optional: boolean, prop: P.PropertyType): string {
	let s = '';
	const [type, extra] = propertyType(prop, name);
	let nameUpper = capatilize(name);
	s += extra;
	s += comment(prop, optional, nameUpper);
	let javaSafeName = JavaSafe(name);
	if (javaSafeName != name) {
		s += line(`@SerializedName(value = "${name}")`)
	}
	s += line(`public ${type} ${javaSafeName};`)

	s += comment(prop, optional, nameUpper);
	let varargsType = type;
	if (type.endsWith('[]')) {
		varargsType = type.substr(0, type.length - 2) + "...";
	}
	s += openBlock(`public ${enclosingType} set${nameUpper}(${varargsType} ${JavaSafe(name)})`)
	s += line(`this.${JavaSafe(name)} = ${JavaSafe(name)};`)
	s += line(`return this;`)
	s += closeBlock()
	s += line();

	return s;
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

let javaroot = process.argv[2]
fs.writeFileSync(`${javaroot}/org/eclipse/lsp4j/debug/DebugProtocol.java`, protocol, { encoding: 'utf-8'});
fs.writeFileSync(`${javaroot}/org/eclipse/lsp4j/debug/services/IDebugProtocolClient.java`, client, { encoding: 'utf-8'});
fs.writeFileSync(`${javaroot}/org/eclipse/lsp4j/debug/services/IDebugProtocolServer.java`, server, { encoding: 'utf-8'});
console.log(`Generation of Debug Protocol java files complete in ${javaroot}.`)
console.log(`Please format and organize imports on the Java files.`)
