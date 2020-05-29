//@flow
import type {WorkerClient} from "./WorkerClient"
import {EventController} from "./EventController"
import {EntropyCollector} from "./EntropyCollector"
import {SearchModel} from "../../search/SearchModel"
import {assertMainOrNode} from "../Env"
import {logins} from "./LoginController"
import type {CalendarUpdateDistributor} from "../../calendar/CalendarUpdateDistributor"
import type {MailboxDetail} from "../../mail/MailModel"
import {MailModel} from "../../mail/MailModel"
import {asyncImport} from "../common/utils/Utils"
import type {CalendarInfo} from "../../calendar/CalendarView"
import type {CalendarEvent} from "../entities/tutanota/CalendarEvent"
import {Notifications} from "../../gui/Notifications"
import type {CalendarEventViewModel} from "../../calendar/CalendarEventViewModel"
import type {API} from "./Entity"
import {ClientsideAPI} from "./Entity"
import type {CalendarModel} from "../../calendar/CalendarModel"

assertMainOrNode()

export type MainLocatorType = {
	eventController: EventController;
	entropyCollector: EntropyCollector;
	search: SearchModel;
	calendarUpdateDistributor: () => Promise<CalendarUpdateDistributor>;
	// Async because we have dependency cycles all over the place. It's also a good idea to not import it right away.
	calendarEventViewModel: (
		date: Date,
		calendars: Map<Id, CalendarInfo>,
		mailboxDetail: MailboxDetail,
		existingEvent?: CalendarEvent,
	) => Promise<CalendarEventViewModel>;
	mailModel: MailModel;
	api: API;
}

export const locator: MainLocatorType = ({}: any)

if (typeof window !== "undefined") {
	window.tutao.locator = locator
}

export function initLocator(worker: WorkerClient) {
	const importBase = typeof module !== "undefined" ? module.id : __moduleName
	locator.eventController = new EventController(logins)
	locator.entropyCollector = new EntropyCollector(worker)
	locator.search = new SearchModel()
	locator.mailModel = new MailModel(new Notifications(), locator.eventController)
	locator.api = new ClientsideAPI()

	locator.calendarUpdateDistributor = () =>
		asyncImport(importBase, `${env.rootPathPrefix}src/calendar/CalendarUpdateDistributor.js`)
			.then(({CalendarMailDistributor}) => new CalendarMailDistributor(locator.mailModel))

	locator.calendarEventViewModel = (date, calendars, mailboxDetail, existingEvent) =>
		Promise.all([
			locator.calendarUpdateDistributor(),
			(asyncImport(importBase, `${env.rootPathPrefix}src/calendar/CalendarEventViewModel.js`):
				Promise<{CalendarEventViewModel: Class<CalendarEventViewModel>}>),
			(asyncImport(importBase, `${env.rootPathPrefix}src/calendar/CalendarModel.js`):
				Promise<{calendarModel: CalendarModel}>),
		]).then(([distributor, {CalendarEventViewModel}, {calendarModel}]) =>
			new CalendarEventViewModel(
				logins.getUserController(),
				distributor,
				calendarModel,
				mailboxDetail,
				date,
				calendars,
				existingEvent,
			)
		)

}