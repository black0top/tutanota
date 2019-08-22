// @flow

import {create, TypeRef} from "../../common/EntityFunctions"


export const CalendarEventUpdateTypeRef: TypeRef<CalendarEventUpdate> = new TypeRef("tutanota", "CalendarEventUpdate")
export const _TypeModel: TypeModel = {
	"name": "CalendarEventUpdate",
	"since": 42,
	"type": "LIST_ELEMENT_TYPE",
	"id": 1103,
	"rootId": "CHR1dGFub3RhAARP",
	"versioned": false,
	"encrypted": false,
	"values": {
		"_format": {
			"name": "_format",
			"id": 1107,
			"since": 42,
			"type": "Number",
			"cardinality": "One",
			"final": false,
			"encrypted": false
		},
		"_id": {
			"name": "_id",
			"id": 1105,
			"since": 42,
			"type": "GeneratedId",
			"cardinality": "One",
			"final": true,
			"encrypted": false
		},
		"_ownerGroup": {
			"name": "_ownerGroup",
			"id": 1108,
			"since": 42,
			"type": "GeneratedId",
			"cardinality": "ZeroOrOne",
			"final": true,
			"encrypted": false
		},
		"_permissions": {
			"name": "_permissions",
			"id": 1106,
			"since": 42,
			"type": "GeneratedId",
			"cardinality": "One",
			"final": true,
			"encrypted": false
		}
	},
	"associations": {
		"file": {
			"name": "file",
			"id": 1109,
			"since": 42,
			"type": "LIST_ELEMENT_ASSOCIATION",
			"cardinality": "One",
			"refType": "File",
			"final": false,
			"external": false
		}
	},
	"app": "tutanota",
	"version": "42"
}

export function createCalendarEventUpdate(values?: $Shape<$Exact<CalendarEventUpdate>>): CalendarEventUpdate {
	return Object.assign(create(_TypeModel, CalendarEventUpdateTypeRef), values)
}

export type CalendarEventUpdate = {
	_type: TypeRef<CalendarEventUpdate>;

	_format: NumberString;
	_id: IdTuple;
	_ownerGroup: ?Id;
	_permissions: Id;

	file: IdTuple;
}