// @flow

import {create, TypeRef} from "../../common/EntityFunctions"


export const RegistrationCaptchaServiceGetDataTypeRef: TypeRef<RegistrationCaptchaServiceGetData> = new TypeRef("sys", "RegistrationCaptchaServiceGetData")
export const _TypeModel: TypeModel = {
	"name": "RegistrationCaptchaServiceGetData",
	"since": 40,
	"type": "DATA_TRANSFER_TYPE",
	"id": 1479,
	"rootId": "A3N5cwAFxw",
	"versioned": false,
	"encrypted": false,
	"values": {
		"_format": {
			"name": "_format",
			"id": 1480,
			"since": 40,
			"type": "Number",
			"cardinality": "One",
			"final": false,
			"encrypted": false
		},
		"mailAddress": {
			"name": "mailAddress",
			"id": 1482,
			"since": 40,
			"type": "String",
			"cardinality": "One",
			"final": false,
			"encrypted": false
		},
		"signupToken": {
			"name": "signupToken",
			"id": 1731,
			"since": 58,
			"type": "String",
			"cardinality": "ZeroOrOne",
			"final": false,
			"encrypted": false
		},
		"token": {
			"name": "token",
			"id": 1481,
			"since": 40,
			"type": "String",
			"cardinality": "ZeroOrOne",
			"final": false,
			"encrypted": false
		}
	},
	"associations": {},
	"app": "sys",
	"version": "60"
}

export function createRegistrationCaptchaServiceGetData(values?: $Shape<$Exact<RegistrationCaptchaServiceGetData>>): RegistrationCaptchaServiceGetData {
	return Object.assign(create(_TypeModel, RegistrationCaptchaServiceGetDataTypeRef), values)
}

export type RegistrationCaptchaServiceGetData = {
	_type: TypeRef<RegistrationCaptchaServiceGetData>;

	_format: NumberString;
	mailAddress: string;
	signupToken: ?string;
	token: ?string;
}