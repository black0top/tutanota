//@flow
import type {WorkerClient} from "./WorkerClient"
import {EventController} from "./EventController"
import {EntropyCollector} from "./EntropyCollector"
import {SearchModel} from "../../search/SearchModel"
import {assertMainOrNode} from "../Env"
import {logins} from "./LoginController"
import type {CalendarUpdateDistributor} from "../../calendar/CalendarUpdateDistributor"
import {CalendarEventViewModel} from "../../calendar/CalendarEventViewModel"
import {CalendarMailDistributor} from "../../calendar/CalendarUpdateDistributor"
import {MailModel} from "../../mail/MailModel"
import {lazyMemoized} from "../common/utils/Utils"
import type {CalendarInfo} from "../../calendar/CalendarView"
import type {MailboxDetail} from "../../mail/MailModel"
import type {CalendarEvent} from "../entities/tutanota/CalendarEvent"
import {Notifications} from "../../gui/Notifications"

assertMainOrNode()

export type MainLocatorType = {
	eventController: EventController;
	entropyCollector: EntropyCollector;
	search: SearchModel;
	calendarUpdateDistributor: () => CalendarUpdateDistributor;
	calendarEventViewModel: (
		date: Date,
		calendars: Map<Id, CalendarInfo>,
		mailboxDetail: MailboxDetail,
		existingEvent?: CalendarEvent,
	) => CalendarEventViewModel;
	mailModel: MailModel;
}

export const locator: MainLocatorType = ({}: any)

if (typeof window !== "undefined") {
	window.tutao.locator = locator
}

export function initLocator(worker: WorkerClient) {
	locator.eventController = new EventController(logins)
	locator.entropyCollector = new EntropyCollector(worker)
	locator.search = new SearchModel()
	locator.mailModel = new MailModel(new Notifications(), locator.eventController)
	locator.calendarUpdateDistributor = lazyMemoized(() => new CalendarMailDistributor(locator.mailModel))
	locator.calendarEventViewModel = (date, calendars, mailboxDetail, existingEvent) => new CalendarEventViewModel(
		logins.getUserController(),
		locator.calendarUpdateDistributor(),
		mailboxDetail,
		date,
		calendars,
		existingEvent,
	)
}