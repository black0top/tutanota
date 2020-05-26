// @flow

import {create, TypeRef} from "../../common/EntityFunctions"

import type {CalendarEventIndexRef} from "./CalendarEventIndexRef"

export const CalendarGroupRootTypeRef: TypeRef<CalendarGroupRoot> = new TypeRef("tutanota", "CalendarGroupRoot")
export const _TypeModel: TypeModel = {
	"name": "CalendarGroupRoot",
	"since": 33,
	"type": "ELEMENT_TYPE",
	"id": 947,
	"rootId": "CHR1dGFub3RhAAOz",
	"versioned": false,
	"encrypted": true,
	"values": {
		"_format": {
			"name": "_format",
			"id": 951,
			"since": 33,
			"type": "Number",
			"cardinality": "One",
			"final": false,
			"encrypted": false
		},
		"_id": {
			"name": "_id",
			"id": 949,
			"since": 33,
			"type": "GeneratedId",
			"cardinality": "One",
			"final": true,
			"encrypted": false
		},
		"_ownerEncSessionKey": {
			"name": "_ownerEncSessionKey",
			"id": 953,
			"since": 33,
			"type": "Bytes",
			"cardinality": "ZeroOrOne",
			"final": true,
			"encrypted": false
		},
		"_ownerGroup": {
			"name": "_ownerGroup",
			"id": 952,
			"since": 33,
			"type": "GeneratedId",
			"cardinality": "ZeroOrOne",
			"final": true,
			"encrypted": false
		},
		"_permissions": {
			"name": "_permissions",
			"id": 950,
			"since": 33,
			"type": "GeneratedId",
			"cardinality": "One",
			"final": true,
			"encrypted": false
		}
	},
	"associations": {
		"index": {
			"name": "index",
			"id": 1103,
			"since": 42,
			"type": "AGGREGATION",
			"cardinality": "ZeroOrOne",
			"refType": "CalendarEventIndexRef",
			"final": false
		},
		"longEvents": {
			"name": "longEvents",
			"id": 955,
			"since": 33,
			"type": "LIST_ASSOCIATION",
			"cardinality": "One",
			"refType": "CalendarEvent",
			"final": true,
			"external": false
		},
		"shortEvents": {
			"name": "shortEvents",
			"id": 954,
			"since": 33,
			"type": "LIST_ASSOCIATION",
			"cardinality": "One",
			"refType": "CalendarEvent",
			"final": true,
			"external": false
		}
	},
	"app": "tutanota",
	"version": "42"
}

export function createCalendarGroupRoot(values?: $Shape<$Exact<CalendarGroupRoot>>): CalendarGroupRoot {
	return Object.assign(create(_TypeModel, CalendarGroupRootTypeRef), values)
}

export type CalendarGroupRoot = {
	_type: TypeRef<CalendarGroupRoot>;
	_errors: Object;

	_format: NumberString;
	_id: Id;
	_ownerEncSessionKey: ?Uint8Array;
	_ownerGroup: ?Id;
	_permissions: Id;

	index: ?CalendarEventIndexRef;
	longEvents: Id;
	shortEvents: Id;
}