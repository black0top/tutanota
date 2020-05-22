//@flow
import {px, size} from "../gui/size"
import stream from "mithril/stream/stream.js"
import {DatePicker} from "../gui/base/DatePicker"
import {Dialog} from "../gui/base/Dialog"
import type {CalendarInfo} from "./CalendarView"
import m from "mithril"
import {TextFieldN} from "../gui/base/TextFieldN"
import {lang} from "../misc/LanguageViewModel"
import type {DropDownSelectorAttrs} from "../gui/base/DropDownSelectorN"
import {DropDownSelectorN} from "../gui/base/DropDownSelectorN"
import {Icons} from "../gui/base/icons/Icons"
import type {CalendarEvent} from "../api/entities/tutanota/CalendarEvent"
import {createCalendarEvent} from "../api/entities/tutanota/CalendarEvent"
import {erase} from "../api/main/Entity"

import {clone, downcast, memoized, neverNull, noOp} from "../api/common/utils/Utils"
import type {ButtonAttrs} from "../gui/base/ButtonN"
import {ButtonN, ButtonType} from "../gui/base/ButtonN"
import type {AlarmIntervalEnum, CalendarAttendeeStatusEnum, EndTypeEnum, RepeatPeriodEnum} from "../api/common/TutanotaConstants"
import {AlarmInterval, CalendarAttendeeStatus, EndType, RepeatPeriod, TimeFormat} from "../api/common/TutanotaConstants"
import {findAndRemove, numberRange, remove} from "../api/common/utils/ArrayUtils"
import type {AlarmInfo} from "../api/entities/sys/AlarmInfo"
import {createAlarmInfo} from "../api/entities/sys/AlarmInfo"
import {logins} from "../api/main/LoginController"
import {
	assignEventId,
	calendarAttendeeStatusDescription,
	createRepeatRuleWithValues,
	filterInt,
	generateUid,
	getAllDayDateForTimezone,
	getAllDayDateUTCFromZone,
	getCalendarName,
	getEventEnd,
	getEventStart,
	getStartOfDayWithZone,
	getStartOfNextDayWithZone,
	getStartOfTheWeekOffsetForUser,
	getTimeZone,
	parseTime,
	timeString,
	timeStringFromParts
} from "./CalendarUtils"
import {generateEventElementId, isAllDayEvent} from "../api/common/utils/CommonCalendarUtils"
import {NotFoundError} from "../api/common/error/RestError"
import {TimePicker} from "../gui/base/TimePicker"
import {createRecipientInfo, getDefaultSenderFromUser, getDisplayText} from "../mail/MailUtils"
import type {MailboxDetail} from "../mail/MailModel"
import type {CalendarEventAttendee} from "../api/entities/tutanota/CalendarEventAttendee"
import {createCalendarEventAttendee} from "../api/entities/tutanota/CalendarEventAttendee"
import type {CalendarRepeatRule} from "../api/entities/tutanota/CalendarRepeatRule"
import {createEncryptedMailAddress} from "../api/entities/tutanota/EncryptedMailAddress"
import {Bubble, BubbleTextField} from "../gui/base/BubbleTextField"
import {MailAddressBubbleHandler} from "../misc/MailAddressBubbleHandler"
import type {Contact} from "../api/entities/tutanota/Contact"
import {attachDropdown} from "../gui/base/DropdownN"
import {HtmlEditor} from "../gui/base/HtmlEditor"
import {Icon} from "../gui/base/Icon"
import {BootIcons} from "../gui/base/icons/BootIcons"
import {CheckboxN} from "../gui/base/CheckboxN"
import {ExpanderButtonN, ExpanderPanelN} from "../gui/base/ExpanderN"
import {client} from "../misc/ClientDetector"
import {worker} from "../api/main/WorkerClient"
import {sendCalendarCancellation, sendCalendarInvite, sendCalendarUpdate} from "./CalendarInvites"
import {incrementByRepeatPeriod} from "./CalendarModel"

const TIMESTAMP_ZERO_YEAR = 1970

class EventViewModel {
	+summary: Stream<string>;
	+calendars: Array<CalendarInfo>;
	+selectedCalendar: Stream<CalendarInfo>;
	startDate: Date;
	endDate: Date;
	startTime: string;
	endTime: string;
	+allDay: Stream<boolean>;
	repeat: ?{frequency: RepeatPeriodEnum, interval: number, endType: EndTypeEnum, endValue: number}
	+attendees: Array<CalendarEventAttendee>;
	organizer: ?string;
	+possibleOrgannizers: $ReadOnlyArray<string>;
	+location: Stream<string>;
	+note: Stream<string>;
	+amPmFormat: bool;
	+existingEvent: ?CalendarEvent
	_oldStartTime: ?string;
	+readOnly: bool;
	+_zone: string;
	// We keep alarms read-only so that view can diff just array and not all elements
	alarms: $ReadOnlyArray<AlarmInfo>;

	constructor(date: Date, calendars: Map<Id, CalendarInfo>, mailboxDetail: MailboxDetail, existingEvent?: CalendarEvent) {
		this.summary = stream("")
		this.calendars = Array.from(calendars.values())
		this.selectedCalendar = stream(this.calendars[0])
		this.attendees = existingEvent && existingEvent.attendees.slice() || []
		this.organizer = existingEvent && existingEvent.organizer || getDefaultSenderFromUser()
		// TODO
		this.possibleOrgannizers = [this.organizer]
		this.location = stream("")
		this.note = stream("")
		this.allDay = stream(true)
		this.amPmFormat = logins.getUserController().userSettingsGroupRoot.timeFormat === TimeFormat.TWELVE_HOURS
		this.existingEvent = existingEvent
		this._zone = getTimeZone()
		this.startDate = getStartOfDayWithZone(date, this._zone)
		this.endDate = getStartOfDayWithZone(date, this._zone)
		this.alarms = []
		this.readOnly = false // TODO

		/**
		 * Capability for events is fairly complicated:
		 * Not share "shared" means "not owner of the calendar". Calendar always looks like personal for the owner.
		 *
		 * | Calendar | Organizer | Can do |
		 * |----------|-----------|---------
		 * | Personal | Self      | everything
		 * | Personal | Other     | everything (local copy of shared event)
		 * | Shared   | Self      | everything
		 * | Shared   | Other     | cannot modify if there are guests
		 */

		// TODO: re-do this capability things, some of them should be dynamic
		// const user = logins.getUserController().user
		// let calendarArray = Array.from(calendars.values())
		// let readOnly = false
		// const mailAddresses = getEnabledMailAddresses(mailboxDetail)
		// const attendees = existingEvent && existingEvent.attendees.slice() || []
		// const organizer = stream(existingEvent && existingEvent.organizer || getDefaultSenderFromUser())
		// const isOwnEvent = mailAddresses.includes(organizer())
		// let canModifyGuests = isOwnEvent
		// let canModifyOwnAttendance = true
		//
		// if (!existingEvent) {
		// 	calendarArray = calendarArray.filter(calendarInfo => hasCapabilityOnGroup(user, calendarInfo.group, ShareCapability.Write))
		// } else {
		// 	// OwnerGroup is not set for invites
		// 	const calendarInfoForEvent = existingEvent._ownerGroup && calendars.get(existingEvent._ownerGroup)
		// 	if (calendarInfoForEvent) {
		// 		readOnly = !hasCapabilityOnGroup(logins.getUserController().user, calendarInfoForEvent.group, ShareCapability.Write)
		// 			|| calendarInfoForEvent.shared && attendees.length > 0
		// 		canModifyGuests = isOwnEvent && !calendarInfoForEvent.shared
		// 		canModifyOwnAttendance = !calendarInfoForEvent.shared
		// 	}
		// }

		if (existingEvent) {
			this.summary(existingEvent.summary)
			const calendarForGroup = calendars.get(neverNull(existingEvent._ownerGroup))
			if (calendarForGroup) {
				this.selectedCalendar(calendarForGroup)
			}
			this.allDay(isAllDayEvent(existingEvent))
			if (this.allDay()) {
				this.startTime = timeString(getEventStart(existingEvent, this._zone), this.amPmFormat)
				this.endTime = timeString(getEventEnd(existingEvent, this._zone), this.amPmFormat)
			}
			if (existingEvent.repeatRule) {
				const existingRule = existingEvent.repeatRule
				const repeat = {
					frequency: downcast(existingRule.frequency),
					interval: Number(existingRule.interval),
					endType: downcast(existingRule.endType),
					endValue: existingRule.endType === EndType.Count ? Number(existingRule.endValue) : 1,
				}
				// TODO end type date
				if (existingRule.endType === EndType.UntilDate) {
					const rawEndDate = new Date(Number(existingRule.endValue))
					const localDate = this.allDay() ? getAllDayDateForTimezone(rawEndDate, this._zone) : rawEndDate
					// Shown date is one day behind the actual end (for us it's excluded)
					const shownDate = incrementByRepeatPeriod(localDate, RepeatPeriod.DAILY, -1, this._zone)
					repeat.endValue = shownDate.getTime()
				}
				this.repeat = repeat
			} else {
				this.repeat = null
			}
			this.location(existingEvent.location)
			this.note(existingEvent.description)

			// TODO: alarms
			// for (let alarmInfoId of existingEvent.alarmInfos) {
			// 	if (isSameId(listIdPart(alarmInfoId), neverNull(user.alarmInfoList).alarms)) {
			// 		load(UserAlarmInfoTypeRef, alarmInfoId).then((userAlarmInfo) => {
			// 			lastThrow(alarmPickerAttrs).selectedValue(downcast(userAlarmInfo.alarmInfo.trigger))
			// 			m.redraw()
			// 		})
			// 	}
			// }
		} else {
			const endTimeDate = new Date(date)
			endTimeDate.setMinutes(endTimeDate.getMinutes() + 30)
			this.startTime = timeString(date, this.amPmFormat)
			this.endTime = timeString(endTimeDate, this.amPmFormat)
			m.redraw()
		}
	}

	onStartTimeSelected(value: string) {
		this.startTime = value
		if (this.startDate.getTime() === this.endDate.getTime()) {
			this._adjustEndTime()
		}
	}

	onEndTimeSelected(value: string) {
		this.endTime = value
	}

	addAttendee(mailAddress: string) {
		const attendee = createCalendarEventAttendee({
			status: CalendarAttendeeStatus.NEEDS_ACTION,
			address: createEncryptedMailAddress({address: mailAddress}),
		})
		this.attendees.push(attendee)
	}

	_adjustEndTime() {
		const parsedOldStartTime = this._oldStartTime && parseTime(this._oldStartTime)
		const parsedStartTime = parseTime(this.startTime)
		const parsedEndTime = parseTime(this.endTime)
		if (!parsedStartTime || !parsedEndTime || !parsedOldStartTime) {
			return
		}
		const endTotalMinutes = parsedEndTime.hours * 60 + parsedEndTime.minutes
		const startTotalMinutes = parsedStartTime.hours * 60 + parsedStartTime.minutes
		const diff = Math.abs(endTotalMinutes - parsedOldStartTime.hours * 60 - parsedOldStartTime.minutes)
		const newEndTotalMinutes = startTotalMinutes + diff
		let newEndHours = Math.floor(newEndTotalMinutes / 60)
		if (newEndHours > 23) {
			newEndHours = 23
		}
		const newEndMinutes = newEndTotalMinutes % 60
		this.endTime = timeStringFromParts(newEndHours, newEndMinutes, this.amPmFormat)
		this._oldStartTime = this.startTime
	}

	onStartDateSelected(date: ?Date) {
		if (date) {
			// The custom ID for events is derived from the unix timestamp, and sorting the negative ids is a challenge we decided not to
			// tackle because it is a rare case.
			if (date && date.getFullYear() < TIMESTAMP_ZERO_YEAR) {
				const thisYear = (new Date()).getFullYear()
				let newDate = new Date(date)
				newDate.setFullYear(thisYear)
				this.startDate = newDate
			} else {
				this.startDate = date
			}
		}
	}

	onEndDateSelected(date: ?Date) {
		if (date) {
			this.endDate = date
		}
	}

	onRepeatPeriodSelected(repeatPeriod: ?RepeatPeriodEnum) {
		if (repeatPeriod == null) {
			this.repeat = null
		} else {
			// Provide default values if repeat is not there, override them with existing repeat if it's there, provide new frequency
			// First empty object is for Flow.
			this.repeat = Object.assign({}, {interval: 1, endType: EndType.Never, endValue: 1}, this.repeat, {frequency: repeatPeriod})
		}
	}

	onEndOccurencesSelected(endValue: number) {
		if (this.repeat && this.repeat.endType === EndType.Count) {
			this.repeat.endValue = endValue
		}
	}

	onRepeatEndDateSelected(endDate: ?Date) {
		const {repeat} = this
		if (endDate && repeat && repeat.endType === EndType.UntilDate) {
			repeat.endValue = endDate.getTime()
		}
	}

	onRepeatIntervalChanged(interval: number) {
		if (this.repeat) {
			this.repeat.interval = interval
		}
	}

	onRepeatEndTypeChanged(endType: EndTypeEnum) {
		const {repeat} = this
		if (repeat) {
			repeat.endType = endType
			if (endType === EndType.UntilDate) {
				// TODO: improve
				repeat.endValue = new Date().getTime()
			} else {
				repeat.endValue = 1
			}
		}
	}

	addAlarm(trigger: AlarmIntervalEnum) {
		const alarm = createCalendarAlarm(generateEventElementId(Date.now()), trigger)
		this.alarms = this.alarms.concat(alarm)
	}

	changeAlarm(identifier: string, trigger: ?AlarmIntervalEnum) {
		const newAlarms = this.alarms.slice()
		for (let i = 0; i < newAlarms.length; i++) {
			if (newAlarms[i].alarmIdentifier === identifier) {
				if (trigger) {
					newAlarms[i].trigger = trigger
				} else {
					newAlarms.splice(i, 1)
				}
				this.alarms = newAlarms
				break
			}
		}
	}

	canModifyGuests(): boolean {
		return true // TODO
	}

	removeAttendee(guest: CalendarEventAttendee) {
		remove(this.attendees, guest)
	}

	canModifyOwnAttendance(): boolean {
		return true // TODO
	}

	canModifyOrganizer(): bool {
		return true // TODO
	}

	/**
	 * @return Promise<bool> whether to close dialog
	 */
	deleteEvent(): Promise<bool> {
		if (this.existingEvent == null) {
			return Promise.resolve(true)
		}
		const p = this.existingEvent.repeatRule
			? Dialog.confirm("deleteRepeatingEventConfirmation_msg")
			: Promise.resolve(true)
		return p.then((answer) => {
			if (answer) {
				// TODO: invite
				// if (isOwnEvent && existingEvent.attendees.length) {
				// 	sendCalendarCancellation(existingEvent, existingEvent.attendees.map(a => a.address))
				// }
				erase(this.existingEvent).catch(NotFoundError, noOp)
			}
			return answer
		})
	}

	onOkPressed(): boolean {
		// We have to use existing instance to get all the final fields correctly
		// Using clone feels hacky but otherwise we need to save all attributes of the existing event somewhere and if dialog is
		// cancelled we also don't want to modify passed event
		const newEvent = this.existingEvent ? clone(this.existingEvent) : createCalendarEvent()

		let startDate = new Date(this.startDate)
		let endDate = new Date(this.endDate)

		if (this.allDay()) {
			startDate = getAllDayDateUTCFromZone(startDate, this._zone)
			endDate = getAllDayDateUTCFromZone(getStartOfNextDayWithZone(endDate, this._zone), this._zone)
		} else {
			const parsedStartTime = parseTime(this.startTime)
			const parsedEndTime = parseTime(this.endTime)
			if (!parsedStartTime || !parsedEndTime) {
				Dialog.error("timeFormatInvalid_msg")
				return false
			}
			startDate.setHours(parsedStartTime.hours)
			startDate.setMinutes(parsedStartTime.minutes)

			// End date is never actually included in the event. For the whole day event the next day
			// is the boundary. For the timed one the end time is the boundary.
			endDate.setHours(parsedEndTime.hours)
			endDate.setMinutes(parsedEndTime.minutes)
		}

		if (endDate.getTime() <= startDate.getTime()) {
			Dialog.error('startAfterEnd_label')
			return false
		}
		newEvent.startTime = startDate
		newEvent.description = this.note()
		newEvent.summary = this.summary()
		newEvent.location = this.location()
		newEvent.endTime = endDate
		const groupRoot = this.selectedCalendar().groupRoot
		newEvent._ownerGroup = this.selectedCalendar().groupRoot._id
		newEvent.uid = this.existingEvent && this.existingEvent.uid ? this.existingEvent.uid : generateUid(newEvent, Date.now())
		const repeat = this.repeat
		if (repeat == null) {
			newEvent.repeatRule = null
		} else {
			const interval = repeat.interval || 1
			const repeatRule = createRepeatRuleWithValues(repeat.frequency, interval)
			newEvent.repeatRule = repeatRule

			const stopType = repeat.endType
			repeatRule.endType = stopType
			if (stopType === EndType.Count) {
				const count = repeat.endValue
				if (isNaN(count) || Number(count) < 1) {
					repeatRule.endType = EndType.Never
				} else {
					repeatRule.endValue = String(count)
				}
			} else if (stopType === EndType.UntilDate) {
				const repeatEndDate = getStartOfNextDayWithZone(new Date(repeat.endValue), this._zone)
				if (repeatEndDate.getTime() < getEventStart(newEvent, this._zone)) {
					Dialog.error("startAfterEnd_label")
					return false
				} else {
					// We have to save repeatEndDate in the same way we save start/end times because if one is timzone
					// dependent and one is not then we have interesting bugs in edge cases (event created in -11 could
					// end on another date in +12). So for all day events end date is UTC-encoded all day event and for
					// regular events it is just a timestamp.
					repeatRule.endValue = String((this.allDay() ? getAllDayDateUTCFromZone(repeatEndDate, this._zone) : repeatEndDate).getTime())
				}
			}
		}
		const newAlarms = []
		// TODO: alarms
		// for (let pickerAttrs of alarmPickerAttrs) {
		// 	const alarmValue = pickerAttrs.selectedValue()
		// 	if (alarmValue) {
		// 		const newAlarm = createCalendarAlarm(generateEventElementId(Date.now()), alarmValue)
		// 		newAlarms.push(newAlarm)
		// 	}
		// }
		newEvent.attendees = this.attendees
		if (this.existingEvent) {
			newEvent.sequence = String(filterInt(this.existingEvent.sequence) + 1)
		}
		let newAttendees = []
		let existingAttendees = []

		newEvent.organizer = this.organizer

		// TODO: invites
		// if (isOwnEvent) {
		// 	if (existingEvent) {
		// 		attendees.forEach((a) => {
		// 			if (existingEvent.attendees.includes(a)) {
		// 				existingAttendees.push(a)
		// 			} else {
		// 				newAttendees.push(a)
		// 			}
		// 		})
		// 	} else {
		// 		newAttendees = attendees
		// 	}
		// } else {
		// 	if (ownAttendee && participationStatus() !== CalendarAttendeeStatus.NEEDS_ACTION
		// 		&& ownAttendee.status !== participationStatus()) {
		// 		ownAttendee.status = participationStatus()
		//
		// 		newEvent.attendees = attendees
		// 		sendCalendarInviteResponse(newEvent, createMailAddress({
		// 			name: ownAttendee.address.name,
		// 			address: ownAttendee.address.address,
		// 		}), participationStatus())
		// 	}
		// }

		;(existingAttendees.length ? Dialog.confirm("sendEventUpdate_msg") : Promise.resolve(false)).then((shouldSendOutUpdates) => {
			let updatePromise
			const safeExistingEvent = this.existingEvent
			if (safeExistingEvent == null
				|| safeExistingEvent._ownerGroup !== newEvent._ownerGroup // event has been moved to another calendar
				|| newEvent.startTime.getTime() !== safeExistingEvent.startTime.getTime()
				|| !repeatRulesEqual(newEvent.repeatRule, safeExistingEvent.repeatRule)) {
				// if values of the existing events have changed that influence the alarm time then delete the old event and create a new one.
				assignEventId(newEvent, this._zone, groupRoot)
				// Reset ownerEncSessionKey because it cannot be set for new entity, it will be assigned by the CryptoFacade
				newEvent._ownerEncSessionKey = null
				// Reset permissions because server will assign them
				downcast(newEvent)._permissions = null

				// We don't want to pass event from ics file to the facade because it's just a template event and there's nothing ot clean
				// up.
				const oldEventToPass = safeExistingEvent && safeExistingEvent._ownerGroup ? safeExistingEvent : null
				updatePromise = worker.createCalendarEvent(newEvent, newAlarms, oldEventToPass)
			} else {
				updatePromise = worker.updateCalendarEvent(newEvent, newAlarms, safeExistingEvent)
			}

			updatePromise
				// Let the dialog close first to avoid glitches
				.delay(200)
				.then(() => {
					if (newAttendees.length) {
						sendCalendarInvite(newEvent, newAlarms, newAttendees.map(a => a.address))
					}
					if (shouldSendOutUpdates) {
						sendCalendarUpdate(newEvent, existingAttendees.map(a => a.address))
					}
					if (safeExistingEvent) {
						const removedAttendees = safeExistingEvent.attendees.filter(att => !this.attendees.includes(att))
						if (removedAttendees.length > 0) {
							sendCalendarCancellation(safeExistingEvent, removedAttendees.map(a => a.address))
						}
					}
				})
		})
		return true
	}
}

export function showCalendarEventDialog(date: Date, calendars: Map<Id, CalendarInfo>, mailboxDetail: MailboxDetail,
                                        existingEvent?: CalendarEvent) {

	const viewModel = new EventViewModel(date, calendars, mailboxDetail, existingEvent)

	const startOfTheWeekOffset = getStartOfTheWeekOffsetForUser()
	const startDatePicker = new DatePicker(startOfTheWeekOffset, "dateFrom_label", "emptyString_msg", true, viewModel.readOnly)
	const endDatePicker = new DatePicker(startOfTheWeekOffset, "dateTo_label", "emptyString_msg", true, viewModel.readOnly)
	startDatePicker.date.map((date) => viewModel.onStartDateSelected(date))
	endDatePicker.date.map((date) => viewModel.onEndDateSelected(date))

	const repeatValues = createRepeatValues()
	const intervalValues = createIntevalValues()
	const endTypeValues = createEndTypeValues()
	const repeatEndDatePicker = new DatePicker(startOfTheWeekOffset, "emptyString_msg", "emptyString_msg", true)
	repeatEndDatePicker.date.map((date) => viewModel.onRepeatEndDateSelected(date))

	const alarmIntervalItems = [
		{name: lang.get("comboBoxSelectionNone_msg"), value: null},
		{name: lang.get("calendarReminderIntervalFiveMinutes_label"), value: AlarmInterval.FIVE_MINUTES},
		{name: lang.get("calendarReminderIntervalTenMinutes_label"), value: AlarmInterval.TEN_MINUTES},
		{name: lang.get("calendarReminderIntervalThirtyMinutes_label"), value: AlarmInterval.THIRTY_MINUTES},
		{name: lang.get("calendarReminderIntervalOneHour_label"), value: AlarmInterval.ONE_HOUR},
		{name: lang.get("calendarReminderIntervalOneDay_label"), value: AlarmInterval.ONE_DAY},
		{name: lang.get("calendarReminderIntervalTwoDays_label"), value: AlarmInterval.TWO_DAYS},
		{name: lang.get("calendarReminderIntervalThreeDays_label"), value: AlarmInterval.THREE_DAYS},
		{name: lang.get("calendarReminderIntervalOneWeek_label"), value: AlarmInterval.ONE_WEEK}
	]

	const endOccurrencesStream = memoized(stream)

	function renderEndValue(): Children {
		if (viewModel.repeat == null || viewModel.repeat.endType === EndType.Never) {
			return null
		} else if (viewModel.repeat.endType === EndType.Count) {
			return m(DropDownSelectorN, {
				label: "emptyString_msg",
				items: intervalValues,
				selectedValue: endOccurrencesStream(viewModel.repeat.endValue),
				selectionChangedHandler: (endValue: number) => viewModel.onEndOccurencesSelected(endValue),
				icon: BootIcons.Expand,
			})
		} else if (viewModel.repeat.endType === EndType.UntilDate) {
			repeatEndDatePicker.setDate(new Date(viewModel.repeat.endValue))
			return m(repeatEndDatePicker)
		} else {
			return null
		}
	}

	const participationStatus = stream(CalendarAttendeeStatus.NEEDS_ACTION)

	const participationDropdownAttrs = {
		// TODO: translate
		label: () => "Going?",
		items: [
			{name: lang.get("noSelection_msg"), value: CalendarAttendeeStatus.NEEDS_ACTION, selectable: false},
			{name: lang.get("yes_label"), value: CalendarAttendeeStatus.ACCEPTED},
			{name: lang.get("maybe_label"), value: CalendarAttendeeStatus.TENTATIVE},
			{name: lang.get("no_label"), value: CalendarAttendeeStatus.DECLINED},
		],
		selectedValue: participationStatus,
	}

	const editorOptions = {enabled: false, alignmentEnabled: false, fontSizeEnabled: false}
	const descriptionEditor = new HtmlEditor("description_label", editorOptions, () => m(ButtonN, {
			label: "emptyString_msg",
			title: 'showRichTextToolbar_action',
			icon: () => Icons.FontSize,
			click: () => editorOptions.enabled = !editorOptions.enabled,
			isSelected: () => editorOptions.enabled,
			noBubble: true,
			type: ButtonType.Toggle,
		})
	)
		.setValue(existingEvent ? existingEvent.description : "")
		.setMinHeight(400)
		.showBorders()
		.setEnabled(!viewModel.readOnly)

	const okAction = (dialog) => {
		if (viewModel.onOkPressed()) {
			dialog.close()
		}
	}

	const attendeesField = makeAttendeesField((bubble) => {
		viewModel.addAttendee(bubble.entity.mailAddress)
		remove(attendeesField.bubbles, bubble)
	})

	const attendeesExpanded = stream(false)

	const renderInviting = (): Children => viewModel.canModifyGuests() ? m(attendeesField) : null

	function renderAttendees() {
		const iconForStatus = {
			[CalendarAttendeeStatus.ACCEPTED]: Icons.Checkmark,
			[CalendarAttendeeStatus.TENTATIVE]: BootIcons.Help,
			[CalendarAttendeeStatus.DECLINED]: Icons.Cancel,
			[CalendarAttendeeStatus.NEEDS_ACTION]: null
		}

		function renderStatusIcon(attendee: CalendarEventAttendee): Children {
			const icon = iconForStatus[attendee.status]

			const iconElement = icon
				? m(Icon, {icon})
				: m(".icon", {
					style: {display: "inline-block"}
				})
			const status: CalendarAttendeeStatusEnum = downcast(attendee.status)
			return m("", {
				style: {display: "inline-block"},
				title: calendarAttendeeStatusDescription(status)
			}, iconElement)
		}

		const renderGuest = a => m(".flex.mr-negative-s", [
			m(".flex-grow", {
					style: {
						height: px(size.button_height),
						"lineHeight": px(size.button_height),
					},
				},
				[renderStatusIcon(a), `${a.address.name || ""} ${a.address.address}`]
			),
			viewModel.canModifyGuests()
				? m(ButtonN, {
					label: "delete_action",
					type: ButtonType.Action,
					icon: () => Icons.Cancel,
					click: () => viewModel.removeAttendee(a)
				})
				: null
		])

		return m(".pt-s", viewModel.attendees.map(renderGuest))
	}

	function renderOrganizer(): Children {
		return m(DropDownSelectorN, {
			label: "organizer_label",
			items: viewModel.possibleOrgannizers.map((address) => ({name: address, value: address})),
			selectedValue: stream(viewModel.organizer || null),
			dropdownWidth: 300,
			disabled: !viewModel.canModifyOrganizer(),
		})
	}

	const renderGoingSelector = () => m(DropDownSelectorN, Object.assign({}, participationDropdownAttrs, {disabled: !viewModel.canModifyOwnAttendance()}))

	const renderDateTimePickers = () => renderTwoColumnsIfFits(
		[
			m(".mr-s.flex-grow", m(startDatePicker)),
			!viewModel.allDay()
				? m(".time-field", m(TimePicker, {
					value: viewModel.startTime,
					onselected: (time) => viewModel.onStartTimeSelected(time),
					amPmFormat: viewModel.amPmFormat,
					disabled: viewModel.readOnly
				}))
				: null
		],
		[
			m(".mr-s.flex-grow", m(endDatePicker)),
			!viewModel.allDay()
				? m(".time-field", m(TimePicker, {
					value: viewModel.endTime,
					onselected: (time) => viewModel.onEndTimeSelected(time),
					amPmFormat: viewModel.amPmFormat,
					disabled: viewModel.readOnly
				}))
				: null
		]
	)

	const renderLocationField = () => m(TextFieldN, {
		label: "location_label",
		value: viewModel.location,
		disabled: viewModel.readOnly,
		injectionsRight: () => {
			let address = encodeURIComponent(viewModel.location())
			if (address === "") {
				return null;
			}
			return m(ButtonN, {
				label: 'showAddress_alt',
				icon: () => Icons.Pin,
				click: () => {
					window.open(`https://www.openstreetmap.org/search?query=${address}`, '_blank')
				}
			})
		}
	})

	function renderCalendarPicker() {
		return m(".flex-half.pl-s", m(DropDownSelectorN, ({
			label: "calendar_label",
			items: viewModel.calendars.map((calendarInfo) => {
				return {name: getCalendarName(calendarInfo.groupInfo, calendarInfo.shared), value: calendarInfo}
			}),
			selectedValue: viewModel.selectedCalendar,
			icon: BootIcons.Expand,
			disabled: viewModel.readOnly
		}: DropDownSelectorAttrs<CalendarInfo>)))
	}

	// Avoid creating stream on each render. Will create new stream if the value is changed.
	// We could just change the value of the stream on each render but ultimately we should avoid
	// passing streams into components.
	const repeatFrequencyStream = memoized(stream)
	const repeatIntervalStream = memoized(stream)
	const endTypeStream = memoized(stream)

	function renderRepeatPeriod() {
		return m(DropDownSelectorN, {
			label: "calendarRepeating_label",
			items: repeatValues,
			selectedValue: repeatFrequencyStream(viewModel.repeat && viewModel.repeat.frequency || null),
			selectionChangedHandler: (period) => viewModel.onRepeatPeriodSelected(period),
			icon: BootIcons.Expand,
			disabled: viewModel.readOnly,
		})
	}

	function renderRepeatInterval() {
		return m(DropDownSelectorN, {
			label: "interval_title",
			items: intervalValues,
			selectedValue: repeatIntervalStream(viewModel.repeat && viewModel.repeat.interval || 1),
			selectionChangedHandler: (period) => viewModel.onRepeatIntervalChanged(period),
			icon: BootIcons.Expand,
			disabled: viewModel.readOnly
		})
	}

	function renderEndType(repeat) {
		return m(DropDownSelectorN, {
				label: () => lang.get("calendarRepeatStopCondition_label"),
				items: endTypeValues,
				selectedValue: endTypeStream(repeat.endType),
				selectionChangedHandler: (period) => viewModel.onRepeatEndTypeChanged(period),
				icon: BootIcons.Expand,
				disabled: viewModel.readOnly,
			}
		)
	}

	const renderRepeatRulePicker = () => renderTwoColumnsIfFits([
			// Repeat type == Frequency: Never, daily, annually etc
			m(".flex-grow", renderRepeatPeriod()),
			// Repeat interval: every day, every second day etc
			m(".flex-grow.ml-s"
				+ (viewModel.repeat ? "" : ".hidden"), renderRepeatInterval()),
		],
		viewModel.repeat
			? [
				m(".flex-grow", renderEndType(viewModel.repeat)),
				m(".flex-grow.ml-s", renderEndValue()),
			]
			: null
	)

	function renderDialogContent() {
		startDatePicker.setDate(viewModel.startDate)
		endDatePicker.setDate(viewModel.endDate)

		return m(".calendar-edit-container.pb", [
				renderHeading(),
				renderDateTimePickers(),
				m(".flex.items-center", [
					m(CheckboxN, {
						checked: viewModel.allDay,
						disabled: viewModel.readOnly,
						label: () => lang.get("allDay_label")
					}),
					m(".flex-grow"),
					m(ExpanderButtonN, {
						label: "guests_label",
						expanded: attendeesExpanded,
						style: {paddingTop: 0},
					})
				]),
				m(ExpanderPanelN, {
						expanded: attendeesExpanded,
						class: "mb",
					}, renderTwoColumnsIfFits(
					m(".flex-grow", [
						renderGoingSelector(),
						renderOrganizer(),
					]),
					m(".flex-grow", [
						renderInviting(),
						renderAttendees()
					]),
					),
				),
				renderRepeatRulePicker(),
				m(".flex", [
					viewModel.readOnly
						? null
						: m(".flex.col.flex-half.pr-s",
						[
							viewModel.alarms.map((a) => m(DropDownSelectorN, {
								label: "reminderBeforeEvent_label",
								items: alarmIntervalItems,
								selectedValue: stream(downcast(a.trigger)),
								icon: BootIcons.Expand,
								selectionChangedHandler: (value) => viewModel.changeAlarm(a.alarmIdentifier, value),
								key: a.alarmIdentifier
							})),
							m(DropDownSelectorN, {
								label: "reminderBeforeEvent_label",
								items: alarmIntervalItems,
								selectedValue: stream(null),
								icon: BootIcons.Expand,
								selectionChangedHandler: (value) => value && viewModel.addAlarm(value)
							})
						]),
					renderCalendarPicker(),
				]),
				renderLocationField(),
				m(descriptionEditor),
			]
		)
	}

	const moreButtonActions = () => [
		{
			label: "delete_action",
			type: ButtonType.Dropdown,
			icon: () => Icons.Trash,
			click: () => {viewModel.deleteEvent()}
		}
	]

	const renderMoreButton = () => (existingEvent && existingEvent._id && !viewModel.readOnly)
		? m(".mr-negative-s", m(ButtonN, attachDropdown({
			label: "more_label",
			icon: () => Icons.More,
		}, moreButtonActions)))
		: null

	function renderHeading() {
		return m(".flex.items-end", [
			m(TextFieldN, {
				label: "title_placeholder",
				value: viewModel.summary,
				disabled: viewModel.readOnly,
				class: "big-input pt flex-grow mr-s"
			}),
			renderMoreButton(),
		])
	}

	const dialog = Dialog.largeDialog(
		{
			left: [{label: "cancel_action", click: () => dialog.close(), type: ButtonType.Secondary}],
			right: [{label: "ok_action", click: () => okAction(dialog), type: ButtonType.Primary}],
			middle: () => lang.get("createEvent_label"),
		},
		{view: () => m(".calendar-edit-container.pb", renderDialogContent())}
	)
	if (client.isMobileDevice()) {
		// Prevent focusing text field automatically on mobile. It opens keyboard and you don't see all details.
		dialog.setFocusOnLoadFunction(noOp)
	}
	dialog.show()
}

function createCalendarAlarm(identifier: string, trigger: string): AlarmInfo {
	const calendarAlarmInfo = createAlarmInfo()
	calendarAlarmInfo.alarmIdentifier = identifier
	calendarAlarmInfo.trigger = trigger
	return calendarAlarmInfo
}

function createRepeatValues() {
	return [
		{name: lang.get("calendarRepeatIntervalNoRepeat_label"), value: null},
		{name: lang.get("calendarRepeatIntervalDaily_label"), value: RepeatPeriod.DAILY},
		{name: lang.get("calendarRepeatIntervalWeekly_label"), value: RepeatPeriod.WEEKLY},
		{name: lang.get("calendarRepeatIntervalMonthly_label"), value: RepeatPeriod.MONTHLY},
		{name: lang.get("calendarRepeatIntervalAnnually_label"), value: RepeatPeriod.ANNUALLY}
	]
}

function createIntevalValues() {
	return numberRange(1, 256).map(n => {
		return {name: String(n), value: n}
	})
}

function createEndTypeValues() {
	return [
		{name: lang.get("calendarRepeatStopConditionNever_label"), value: EndType.Never},
		{name: lang.get("calendarRepeatStopConditionOccurrences_label"), value: EndType.Count},
		{name: lang.get("calendarRepeatStopConditionDate_label"), value: EndType.UntilDate}
	]
}

function makeAttendeesField(onBubbleCreated: (Bubble<RecipientInfo>) => void): BubbleTextField<RecipientInfo> {
	function createBubbleContextButtons(name: string, mailAddress: string): Array<ButtonAttrs | string> {
		let buttonAttrs = [mailAddress]
		buttonAttrs.push({
			label: "remove_action",
			type: ButtonType.Secondary,
			click: () => {
				findAndRemove(invitePeopleValueTextField.bubbles, (bubble) => bubble.entity.mailAddress === mailAddress)
			},
		})
		return buttonAttrs
	}

	const bubbleHandler = new MailAddressBubbleHandler({
		createBubble(name: ?string, mailAddress: string, contact: ?Contact): Bubble<RecipientInfo> {
			const recipientInfo = createRecipientInfo(mailAddress, name, contact, false)
			const buttonAttrs = attachDropdown({
				label: () => getDisplayText(recipientInfo.name, mailAddress, false),
				type: ButtonType.TextBubble,
				isSelected: () => false,
			}, () => createBubbleContextButtons(recipientInfo.name, mailAddress))
			const bubble = new Bubble(recipientInfo, buttonAttrs, mailAddress)
			Promise.resolve().then(() => onBubbleCreated(bubble))
			return bubble
		},

	})
	const invitePeopleValueTextField = new BubbleTextField("shareWithEmailRecipient_label", bubbleHandler, {marginLeft: 0})
	return invitePeopleValueTextField
}

function renderTwoColumnsIfFits(left: Children, right: Children): Children {
	if (client.isMobileDevice()) {
		return m(".flex.col", [
			m(".flex", left),
			m(".flex", right),
		])
	} else {
		return m(".flex", [
			m(".flex.flex-half.pr-s", left),
			m(".flex.flex-half.pl-s", right),
		])
	}
}

// allDay event consists of full UTC days. It always starts at 00:00:00.00 of its start day in UTC and ends at
// 0 of the next day in UTC. Full day event time is relative to the local timezone. So startTime and endTime of
// allDay event just points us to the correct date.
// e.g. there's an allDay event in Europe/Berlin at 2nd of may. We encode it as:
// {startTime: new Date(Date.UTC(2019, 04, 2, 0, 0, 0, 0)), {endTime: new Date(Date.UTC(2019, 04, 3, 0, 0, 0, 0))}}
// We check the condition with time == 0 and take a UTC date (which is [2-3) so full day on the 2nd of May). We
function repeatRulesEqual(repeatRule: ?CalendarRepeatRule, repeatRule2: ?CalendarRepeatRule): boolean {
	return (repeatRule == null && repeatRule2 == null) ||
		(repeatRule != null && repeatRule2 != null &&
			repeatRule.endType === repeatRule2.endType &&
			repeatRule.endValue === repeatRule2.endValue &&
			repeatRule.frequency === repeatRule2.frequency &&
			repeatRule.interval === repeatRule2.interval &&
			repeatRule.timeZone === repeatRule2.timeZone)
}
