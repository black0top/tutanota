//@flow
import o from "ospec/ospec.js"
import {CalendarEventViewModel} from "../../../src/calendar/CalendarEventViewModel"
import {downcast} from "../../../src/api/common/utils/Utils"
import {LazyLoaded} from "../../../src/api/common/utils/LazyLoaded"
import type {MailboxDetail} from "../../../src/mail/MailModel"
import {createCalendarEvent} from "../../../src/api/entities/tutanota/CalendarEvent"
import {createGroupInfo} from "../../../src/api/entities/sys/GroupInfo"
import {TimeFormat} from "../../../src/api/common/TutanotaConstants"
import type {CalendarInfo} from "../../../src/calendar/CalendarView"

const calendarOwnerGroup = "0"

o.spec("CalendarEventViewModel", function () {
	const now = new Date(2020, 4, 25, 13, 40)

	o("init with existing event", function () {
		const calendars = makeCalendars("own")
		const mailboxDetail: MailboxDetail = downcast({})
		const userController: IUserController = makeUserController()
		const existingEvent = createCalendarEvent({
			summary: "existing event",
			startTime: new Date(2020, 4, 26, 12),
			endTime: new Date(2020, 4, 26, 13),
			description: "note",
			location: "location",
			_ownerGroup: calendarOwnerGroup,
		})
		const viewModel = new CalendarEventViewModel(now, calendars, mailboxDetail, userController, existingEvent)

		o(viewModel.summary()).equals(existingEvent.summary)
		o(viewModel.startDate.toISOString()).equals(new Date(2020, 4, 26).toISOString())
		o(viewModel.endDate.toISOString()).equals(new Date(2020, 4, 26).toISOString())
		o(viewModel.startTime).equals("12:00")
		o(viewModel.endTime).equals("13:00")
		o(viewModel.note()).equals(existingEvent.description)
		o(viewModel.location()).equals(existingEvent.location)
		o(viewModel.readOnly).equals(false)
		o(viewModel.canModifyGuests()).equals(true)("canModifyGuests")
	})

	o("invite in our own calendar", function () {
		const calendars = makeCalendars("own")
		const mailboxDetail: MailboxDetail = downcast({})
		const userController: IUserController = makeUserController()
		const existingEvent = createCalendarEvent({
			summary: "existing event",
			startTime: new Date(2020, 4, 26, 12),
			endTime: new Date(2020, 4, 26, 13),
			organizer: "another-user@provider.com",
			_ownerGroup: calendarOwnerGroup,
		})
		const viewModel = new CalendarEventViewModel(now, calendars, mailboxDetail, userController, existingEvent)
		o(viewModel.readOnly).equals(false)
		o(viewModel.canModifyGuests()).equals(false)("canModifyGuests")
	})

	o("new invite (without calendar)", function () {
		const calendars = makeCalendars("own")
		const mailboxDetail: MailboxDetail = downcast({})
		const userController = makeUserController()
		const existingEvent = createCalendarEvent({
			summary: "existing event",
			startTime: new Date(2020, 4, 26, 12),
			endTime: new Date(2020, 4, 26, 13),
			organizer: "another-user@provider.com",
			_ownerGroup: null,
		})
		const viewModel = new CalendarEventViewModel(now, calendars, mailboxDetail, userController, existingEvent)
		o(viewModel.readOnly).equals(false)
		o(viewModel.canModifyGuests()).equals(false)("canModifyGuests")
	})

	o("invite in another calendar", function () {
		const calendars = makeCalendars("shared")
		const mailboxDetail = downcast({})
		const userController = makeUserController()
		const existingEvent = createCalendarEvent({
			summary: "existing event",
			startTime: new Date(2020, 4, 26, 12),
			endTime: new Date(2020, 4, 26, 13),
			organizer: "another-user@provider.com",
			_ownerGroup: calendarOwnerGroup,
		})
		const viewModel = new CalendarEventViewModel(now, calendars, mailboxDetail, userController, existingEvent)
		o(viewModel.readOnly).equals(true)
		o(viewModel.canModifyGuests()).equals(false)("canModifyGuests")
	})
})

function makeCalendars(type: "own" | "shared"): Map<string, CalendarInfo> {
	const calendarInfo = {
		groupRoot: downcast({}),
		longEvents: new LazyLoaded(() => Promise.resolve([])),
		groupInfo: downcast({}),
		group: downcast({}),
		shared: type === "shared"
	}
	return new Map([[calendarOwnerGroup, calendarInfo]])
}

function makeUserController(): IUserController {
	return downcast({
		user: null,
		props: {
			defaultSender: "address@tutanota.com",
		},
		userGroupInfo: createGroupInfo({
			mailAddressAliases: [],
			mailAddress: "address@tutanota.com",
		}),
		userSettingsGroupRoot: {
			timeFormat: TimeFormat.TWENTY_FOUR_HOURS,
		}
	})
}
