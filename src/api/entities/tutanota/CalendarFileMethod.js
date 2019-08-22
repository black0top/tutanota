// @flow

import {create, TypeRef} from "../../common/EntityFunctions"


export const CalendarFileMethodTypeRef: TypeRef<CalendarFileMethod> = new TypeRef("tutanota", "CalendarFileMethod")
export const _TypeModel: TypeModel = {
	"name": "CalendarFileMethod",
	"since": 42,
	"type": "AGGREGATED_TYPE",
	"id": 1110,
	"rootId": "CHR1dGFub3RhAARW",
	"versioned": false,
	"encrypted": false,
	"values": {
		"_id": {
			"name": "_id",
			"id": 1111,
			"since": 42,
			"type": "CustomId",
			"cardinality": "One",
			"final": true,
			"encrypted": false
		},
		"method": {
			"name": "method",
			"id": 1112,
			"since": 42,
			"type": "Number",
			"cardinality": "One",
			"final": true,
			"encrypted": false
		}
	},
	"associations": {
		"file": {
			"name": "file",
			"id": 1113,
			"since": 42,
			"type": "LIST_ELEMENT_ASSOCIATION",
			"cardinality": "One",
			"refType": "File",
			"final": true,
			"external": false
		}
	},
	"app": "tutanota",
	"version": "42"
}

export function createCalendarFileMethod(values?: $Shape<$Exact<CalendarFileMethod>>): CalendarFileMethod {
	return Object.assign(create(_TypeModel, CalendarFileMethodTypeRef), values)
}

export type CalendarFileMethod = {
	_type: TypeRef<CalendarFileMethod>;

	_id: Id;
	method: NumberString;

	file: IdTuple;
}