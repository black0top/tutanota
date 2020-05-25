//@flow
import o from "ospec/ospec.js"
import {CalendarEventViewModel} from "../../../src/calendar/CalendarEventViewModel"
import {downcast} from "../../../src/api/common/utils/Utils"
import {LazyLoaded} from "../../../src/api/common/utils/LazyLoaded"
import type {MailboxDetail} from "../../../src/mail/MailModel"
import {createCalendarEvent} from "../../../src/api/entities/tutanota/CalendarEvent"
import {createGroupInfo} from "../../../src/api/entities/sys/GroupInfo"
import {TimeFormat} from "../../../src/api/common/TutanotaConstants"

o.spec("CalendarEventViewModel", function () {
	o.only("init with existing event", function () {
		const now = new Date(2020, 4, 25, 13, 40)
		const calendarInfo = {
			groupRoot: downcast({}),
			longEvents: new LazyLoaded(() => Promise.resolve([])),
			groupInfo: downcast({}),
			group: downcast({}),
			shared: false
		}
		const calendars = new Map([["0", calendarInfo]])
		const mailboxDetail: MailboxDetail = downcast({})
		const userController: IUserController = downcast({
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

		const existingEvent = createCalendarEvent({
			summary: "existing event",
			startTime: new Date(2020, 4, 26, 12),
			endTime: new Date(2020, 4, 26, 13),
			description: "note",
			location: "location",
		})

		const viewModel = new CalendarEventViewModel(now, calendars, mailboxDetail, userController, existingEvent)

		o(viewModel.summary()).equals(existingEvent.summary)
		o(viewModel.startDate.toISOString()).equals(new Date(2020, 4, 26).toISOString())
		o(viewModel.endDate.toISOString()).equals(new Date(2020, 4, 26).toISOString())
		o(viewModel.startTime).equals("12:00")
		o(viewModel.endTime).equals("13:00")
		o(viewModel.note()).equals(existingEvent.description)
		o(viewModel.location).equals(existingEvent.location)
	})
})