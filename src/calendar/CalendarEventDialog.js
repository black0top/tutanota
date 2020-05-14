//@flow
import {px, size} from "../gui/size"
import {incrementDate} from "../api/common/utils/DateUtils"
import stream from "mithril/stream/stream.js"
import {DatePicker} from "../gui/base/DatePicker"
import {Dialog} from "../gui/base/Dialog"
import type {CalendarInfo} from "./CalendarView"
import {LIMIT_PAST_EVENTS_YEARS} from "./CalendarView"
import m from "mithril"
import {TextFieldN} from "../gui/base/TextFieldN"
import {lang} from "../misc/LanguageViewModel"
import type {DropDownSelectorAttrs} from "../gui/base/DropDownSelectorN"
import {DropDownSelectorN} from "../gui/base/DropDownSelectorN"
import {Icons} from "../gui/base/icons/Icons"
import type {CalendarEvent} from "../api/entities/tutanota/CalendarEvent"
import {createCalendarEvent} from "../api/entities/tutanota/CalendarEvent"
import {erase, load} from "../api/main/Entity"

import {clone, downcast, neverNull, noOp} from "../api/common/utils/Utils"
import type {ButtonAttrs} from "../gui/base/ButtonN"
import {ButtonN, ButtonType} from "../gui/base/ButtonN"
import type {AlarmIntervalEnum, CalendarAttendeeStatusEnum, EndTypeEnum, RepeatPeriodEnum} from "../api/common/TutanotaConstants"
import {
	AlarmInterval,
	CalendarAttendeeStatus,
	EndType,
	getAttendeeStatus,
	RepeatPeriod,
	ShareCapability,
	TimeFormat
} from "../api/common/TutanotaConstants"
import {findAndRemove, last, lastThrow, numberRange, remove} from "../api/common/utils/ArrayUtils"
import {incrementByRepeatPeriod} from "./CalendarModel"
import {DateTime} from "luxon"
import type {AlarmInfo} from "../api/entities/sys/AlarmInfo"
import {createAlarmInfo} from "../api/entities/sys/AlarmInfo"
import {isSameId, listIdPart} from "../api/common/EntityFunctions"
import {logins} from "../api/main/LoginController"
import {UserAlarmInfoTypeRef} from "../api/entities/sys/UserAlarmInfo"
import {
	assignEventId,
	calendarAttendeeStatusDescription,
	createRepeatRuleWithValues,
	filterInt,
	generateUid,
	getAllDayDateForTimezone,
	getAllDayDateUTCFromZone,
	getCalendarName,
	getDiffInDays,
	getEventEnd,
	getEventStart,
	getStartOfDayWithZone,
	getStartOfNextDayWithZone,
	getStartOfTheWeekOffsetForUser,
	getTimeZone,
	hasCapabilityOnGroup,
	parseTime,
	timeString,
	timeStringFromParts
} from "./CalendarUtils"
import {generateEventElementId, isAllDayEvent} from "../api/common/utils/CommonCalendarUtils"
import {worker} from "../api/main/WorkerClient"
import {NotFoundError} from "../api/common/error/RestError"
import {TimePicker} from "../gui/base/TimePicker"
import {createRecipientInfo, getDefaultSenderFromUser, getDisplayText, getEnabledMailAddresses} from "../mail/MailUtils"
import type {MailboxDetail} from "../mail/MailModel"
import type {CalendarEventAttendee} from "../api/entities/tutanota/CalendarEventAttendee"
import {createCalendarEventAttendee} from "../api/entities/tutanota/CalendarEventAttendee"
import {createMailAddress} from "../api/entities/tutanota/MailAddress"
import {sendCalendarCancellation, sendCalendarInvite, sendCalendarInviteResponse, sendCalendarUpdate} from "./CalendarInvites"
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

const TIMESTAMP_ZERO_YEAR = 1970

// allDay event consists of full UTC days. It always starts at 00:00:00.00 of its start day in UTC and ends at
// 0 of the next day in UTC. Full day event time is relative to the local timezone. So startTime and endTime of
// allDay event just points us to the correct date.
// e.g. there's an allDay event in Europe/Berlin at 2nd of may. We encode it as:
// {startTime: new Date(Date.UTC(2019, 04, 2, 0, 0, 0, 0)), {endTime: new Date(Date.UTC(2019, 04, 3, 0, 0, 0, 0))}}
// We check the condition with time == 0 and take a UTC date (which is [2-3) so full day on the 2nd of May). We
function _repeatRulesEqual(repeatRule: ?CalendarRepeatRule, repeatRule2: ?CalendarRepeatRule): boolean {
	return (repeatRule == null && repeatRule2 == null) ||
		(repeatRule != null && repeatRule2 != null &&
			repeatRule.endType === repeatRule2.endType &&
			repeatRule.endValue === repeatRule2.endValue &&
			repeatRule.frequency === repeatRule2.frequency &&
			repeatRule.interval === repeatRule2.interval &&
			repeatRule.timeZone === repeatRule2.timeZone)
}

// interpret it as full day in Europe/Berlin, not in the UTC.
export function showCalendarEventDialog(date: Date, calendars: Map<Id, CalendarInfo>, mailboxDetail: MailboxDetail,
                                        existingEvent?: CalendarEvent) {
	const summary = stream("")
	let calendarArray = Array.from(calendars.values())
	let readOnly = false
	if (!existingEvent) {
		calendarArray = calendarArray.filter(calendarInfo => hasCapabilityOnGroup(logins.getUserController().user, calendarInfo.group, ShareCapability.Write))
	} else {
		const calendarInfoForEvent = calendars.get(neverNull(existingEvent._ownerGroup))
		if (calendarInfoForEvent) {
			readOnly = !hasCapabilityOnGroup(logins.getUserController().user, calendarInfoForEvent.group, ShareCapability.Write)
		}
	}
	const zone = getTimeZone()
	const selectedCalendar = stream(calendarArray[0])
	const startOfTheWeekOffset = getStartOfTheWeekOffsetForUser()
	const startDatePicker = new DatePicker(startOfTheWeekOffset, "dateFrom_label", "emptyString_msg", true, readOnly)
	startDatePicker.setDate(getStartOfDayWithZone(date, zone))
	const endDatePicker = new DatePicker(startOfTheWeekOffset, "dateTo_label", "emptyString_msg", true, readOnly)
	const amPmFormat = logins.getUserController().userSettingsGroupRoot.timeFormat === TimeFormat.TWELVE_HOURS
	const startTime = stream(timeString(date, amPmFormat))
	const endTime = stream()
	const allDay = stream(false)
	const locationValue = stream("")
	const notesValue = stream("")

	const repeatPickerAttrs = createRepeatingDatePicker(readOnly)
	const repeatIntervalPickerAttrs = createIntervalPicker(readOnly)
	const endTypePickerAttrs = createEndTypePicker(readOnly)
	const repeatEndDatePicker = new DatePicker(startOfTheWeekOffset, "emptyString_msg", "emptyString_msg", true)
	const endCountPickerAttrs = createEndCountPicker()

	const alarmPickerAttrs = []

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

	function createAlarmPicker(): DropDownSelectorAttrs<?AlarmIntervalEnum> {
		const selectedValue = stream(null)
		const attrs = {
			label: () => lang.get("reminderBeforeEvent_label"),
			items: alarmIntervalItems,
			selectedValue,
			icon: BootIcons.Expand,
		}
		selectedValue.map((v) => {
			const lastAttrs = last(alarmPickerAttrs)
			if (attrs === lastAttrs && selectedValue() != null) {
				alarmPickerAttrs.push(createAlarmPicker())
			} else if (v == null && alarmPickerAttrs.some(a => a !== attrs && a.selectedValue() == null)) {
				remove(alarmPickerAttrs, attrs)
			}
		})
		return attrs

	}

	alarmPickerAttrs.push(createAlarmPicker())

	const user = logins.getUserController().user

	if (existingEvent) {
		summary(existingEvent.summary)
		const calendarForGroup = calendars.get(neverNull(existingEvent._ownerGroup))
		if (calendarForGroup) {
			selectedCalendar(calendarForGroup)
		}
		startTime(timeString(getEventStart(existingEvent, zone), amPmFormat))
		allDay(existingEvent && isAllDayEvent(existingEvent))
		if (allDay()) {
			endDatePicker.setDate(incrementDate(getEventEnd(existingEvent, zone), -1))
		} else {
			endDatePicker.setDate(getStartOfDayWithZone(getEventEnd(existingEvent, zone), zone))
		}
		endTime(timeString(getEventEnd(existingEvent, zone), amPmFormat))
		if (existingEvent.repeatRule) {
			const existingRule = existingEvent.repeatRule
			repeatPickerAttrs.selectedValue(downcast(existingRule.frequency))
			repeatIntervalPickerAttrs.selectedValue(Number(existingRule.interval))
			endTypePickerAttrs.selectedValue(downcast(existingRule.endType))
			endCountPickerAttrs.selectedValue(existingRule.endType === EndType.Count ? Number(existingRule.endValue) : 1)
			if (existingRule.endType === EndType.UntilDate) {
				const rawEndDate = new Date(Number(existingRule.endValue))
				const localDate = allDay() ? getAllDayDateForTimezone(rawEndDate, zone) : rawEndDate
				// Shown date is one day behind the actual end (for us it's excluded)
				const shownDate = incrementByRepeatPeriod(localDate, RepeatPeriod.DAILY, -1, zone)
				repeatEndDatePicker.setDate(shownDate)
			} else {
				repeatEndDatePicker.setDate(null)
			}
		} else {
			repeatPickerAttrs.selectedValue(null)
		}
		locationValue(existingEvent.location)
		notesValue(existingEvent.description)

		for (let alarmInfoId of existingEvent.alarmInfos) {
			if (isSameId(listIdPart(alarmInfoId), neverNull(user.alarmInfoList).alarms)) {
				load(UserAlarmInfoTypeRef, alarmInfoId).then((userAlarmInfo) => {
					lastThrow(alarmPickerAttrs).selectedValue(downcast(userAlarmInfo.alarmInfo.trigger))
					m.redraw()
				})
			}
		}

	} else {
		const endTimeDate = new Date(date)
		endTimeDate.setMinutes(endTimeDate.getMinutes() + 30)
		endDatePicker.setDate(getStartOfDayWithZone(date, zone))
		endTime(timeString(endTimeDate, amPmFormat))
		m.redraw()
	}

	endTypePickerAttrs.selectedValue.map((endType) => {
		if (endType === EndType.UntilDate && !repeatEndDatePicker.date()) {
			const newRepeatEnd = incrementByRepeatPeriod(neverNull(startDatePicker.date()), neverNull(repeatPickerAttrs.selectedValue()),
				neverNull(repeatIntervalPickerAttrs.selectedValue()), DateTime.local().zoneName)
			repeatEndDatePicker.setDate(newRepeatEnd)
		}
	})

	let eventTooOld: boolean = false
	stream.scan((oldStartDate, startDate) => {
		// The custom ID for events is derived from the unix timestamp, and sorting the negative ids is a challenge we decided not to
		// tackle because it is a rare case.
		if (startDate && startDate.getFullYear() < TIMESTAMP_ZERO_YEAR) {
			const thisYear = (new Date()).getFullYear()
			let newDate = new Date(startDate)
			newDate.setFullYear(thisYear)
			startDatePicker.setDate(newDate)
			return newDate
		}
		const endDate = endDatePicker.date()
		eventTooOld = (!!startDate && -DateTime.fromJSDate(startDate).diffNow("year").years > LIMIT_PAST_EVENTS_YEARS)
		if (startDate && endDate) {
			const diff = getDiffInDays(endDate, neverNull(oldStartDate))
			endDatePicker.setDate(DateTime.fromJSDate(startDate).plus({days: diff}).toJSDate())
		}
		return startDate
	}, startDatePicker.date(), startDatePicker.date)

	let oldStartTime: string = startTime()

	function onStartTimeSelected(value) {
		startTime(value)
		let startDate = neverNull(startDatePicker.date())
		let endDate = neverNull(endDatePicker.date())
		if (startDate.getTime() === endDate.getTime()) {
			adjustEndTime()
		}
	}

	/**
	 * Check if the start time is after the end time and fix that
	 */
	function adjustEndTime() {
		const parsedOldStartTime = oldStartTime && parseTime(oldStartTime)
		const parsedStartTime = parseTime(startTime())
		const parsedEndTime = parseTime(endTime())
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
		endTime(timeStringFromParts(newEndHours, newEndMinutes, amPmFormat))
		oldStartTime = startTime()
		m.redraw()
	}

	function renderStopConditionValue(): Children {
		if (repeatPickerAttrs.selectedValue() == null || endTypePickerAttrs.selectedValue() === EndType.Never) {
			return null
		} else if (endTypePickerAttrs.selectedValue() === EndType.Count) {
			return m(DropDownSelectorN, endCountPickerAttrs)
		} else if (endTypePickerAttrs.selectedValue() === EndType.UntilDate) {
			return m(repeatEndDatePicker)
		} else {
			return null
		}
	}

	const mailAddresses = getEnabledMailAddresses(mailboxDetail)
	const attendees = existingEvent && existingEvent.attendees.slice() || []
	const organizer = stream(existingEvent && existingEvent.organizer || getDefaultSenderFromUser())
	const isOwnEvent = mailAddresses.includes(organizer())

	const participationStatus = stream(CalendarAttendeeStatus.NEEDS_ACTION)
	let ownAttendee
	if (existingEvent && !isOwnEvent) {
		ownAttendee = attendees.find(a => mailAddresses.includes(a.address.address))
		participationStatus(ownAttendee ? getAttendeeStatus(ownAttendee) : CalendarAttendeeStatus.NEEDS_ACTION)
	} else {
		ownAttendee = null
	}

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
		.setEnabled(!readOnly)

	const okAction = (dialog) => {
		// We have to use existing instance to get all the final fields correctly
		// Using clone feels hacky but otherwise we need to save all attributes of the existing event somewhere and if dialog is
		// cancelled we also don't want to modify passed event
		const newEvent = existingEvent ? clone(existingEvent) : createCalendarEvent()
		if (!startDatePicker.date() || !endDatePicker.date()) {
			Dialog.error("timeFormatInvalid_msg")
			return
		}
		let startDate = new Date(neverNull(startDatePicker.date()))
		let endDate = new Date(neverNull(endDatePicker.date()))

		if (allDay()) {
			startDate = getAllDayDateUTCFromZone(startDate, zone)
			endDate = getAllDayDateUTCFromZone(getStartOfNextDayWithZone(endDate, zone), zone)
		} else {
			const parsedStartTime = parseTime(startTime())
			const parsedEndTime = parseTime(endTime())
			if (!parsedStartTime || !parsedEndTime) {
				Dialog.error("timeFormatInvalid_msg")
				return
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
			return
		}
		newEvent.startTime = startDate
		newEvent.description = notesValue()
		newEvent.summary = summary()
		newEvent.location = locationValue()
		newEvent.endTime = endDate
		const groupRoot = selectedCalendar().groupRoot
		newEvent._ownerGroup = selectedCalendar().groupRoot._id
		newEvent.uid = existingEvent && existingEvent.uid ? existingEvent.uid : generateUid(newEvent, Date.now())
		const repeatFrequency = repeatPickerAttrs.selectedValue()
		if (repeatFrequency == null || eventTooOld) {
			newEvent.repeatRule = null
		} else {
			const interval = repeatIntervalPickerAttrs.selectedValue() || 1
			const repeatRule = createRepeatRuleWithValues(repeatFrequency, interval)
			newEvent.repeatRule = repeatRule

			const stopType = neverNull(endTypePickerAttrs.selectedValue())
			repeatRule.endType = stopType
			if (stopType === EndType.Count) {
				let count = endCountPickerAttrs.selectedValue()
				if (isNaN(count) || Number(count) < 1) {
					repeatRule.endType = EndType.Never
				} else {
					repeatRule.endValue = String(count)
				}
			} else if (stopType === EndType.UntilDate) {
				const repeatEndDate = getStartOfNextDayWithZone(neverNull(repeatEndDatePicker.date()), zone)
				if (repeatEndDate.getTime() < getEventStart(newEvent, zone)) {
					Dialog.error("startAfterEnd_label")
					return
				} else {
					// We have to save repeatEndDate in the same way we save start/end times because if one is timzone
					// dependent and one is not then we have interesting bugs in edge cases (event created in -11 could
					// end on another date in +12). So for all day events end date is UTC-encoded all day event and for
					// regular events it is just a timestamp.
					repeatRule.endValue = String((allDay() ? getAllDayDateUTCFromZone(repeatEndDate, zone) : repeatEndDate).getTime())
				}
			}
		}
		const newAlarms = []
		for (let pickerAttrs of alarmPickerAttrs) {
			const alarmValue = pickerAttrs.selectedValue()
			if (alarmValue) {
				const newAlarm = createCalendarAlarm(generateEventElementId(Date.now()), alarmValue)
				newAlarms.push(newAlarm)
			}
		}
		newEvent.attendees = attendees
		if (existingEvent) {
			newEvent.sequence = String(filterInt(existingEvent.sequence) + 1)
		}
		let newAttendees = []
		let existingAttendees = []

		newEvent.organizer = organizer()

		if (isOwnEvent) {
			if (existingEvent) {
				attendees.forEach((a) => {
					if (existingEvent.attendees.includes(a)) {
						existingAttendees.push(a)
					} else {
						newAttendees.push(a)
					}
				})
			} else {
				newAttendees = attendees
			}
		} else {
			if (ownAttendee && participationStatus() !== CalendarAttendeeStatus.NEEDS_ACTION
				&& ownAttendee.status !== participationStatus()) {
				ownAttendee.status = participationStatus()

				newEvent.attendees = attendees
				sendCalendarInviteResponse(newEvent, createMailAddress({
					name: ownAttendee.address.name,
					address: ownAttendee.address.address,
				}), participationStatus())
			}
		}

		;(existingAttendees.length ? Dialog.confirm("sendEventUpdate_msg") : Promise.resolve(false)).then((shouldSendOutUpdates) => {
			let updatePromise
			if (existingEvent == null
				|| existingEvent._ownerGroup !== newEvent._ownerGroup // event has been moved to another calendar
				|| newEvent.startTime.getTime() !== existingEvent.startTime.getTime()
				|| !_repeatRulesEqual(newEvent.repeatRule, existingEvent.repeatRule)) {
				// if values of the existing events have changed that influence the alarm time then delete the old event and create a new one.
				assignEventId(newEvent, zone, groupRoot)
				// Reset ownerEncSessionKey because it cannot be set for new entity, it will be assigned by the CryptoFacade
				newEvent._ownerEncSessionKey = null
				// Reset permissions because server will assign them
				downcast(newEvent)._permissions = null
				updatePromise = worker.createCalendarEvent(newEvent, newAlarms, existingEvent)
			} else {
				updatePromise = worker.updateCalendarEvent(newEvent, newAlarms, existingEvent)
			}
			dialog.close()
			return updatePromise
				// Let the dialog close first to avoid glitches
				.delay(200)
				.then(() => {
					if (newAttendees.length) {
						sendCalendarInvite(newEvent, newAlarms, newAttendees.map(a => a.address))
					}
					if (shouldSendOutUpdates) {
						sendCalendarUpdate(newEvent, existingAttendees.map(a => a.address))
					}
					if (existingEvent) {
						const removedAttendees = existingEvent.attendees.filter(att => !attendees.includes(att))
						if (removedAttendees.length > 0) {
							sendCalendarCancellation(existingEvent, removedAttendees.map(a => a.address))
						}
					}
				})
		})
	}

	const attendeesField = makeAttendeesField((bubble) => {
		const attendee = createCalendarEventAttendee({
			status: CalendarAttendeeStatus.NEEDS_ACTION,
			address: createEncryptedMailAddress({
				address: bubble.entity.mailAddress
			}),
		})
		attendees.push(attendee)
		remove(attendeesField.bubbles, bubble)
	})

	const attendeesExpanded = stream(false)

	function renderInviting(): Children {
		return !isOwnEvent ? null : m(attendeesField)
	}

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

		return m(".pt-s", [
			attendees.map(a => m(".flex.mr-negative-s", [
				m(".flex-grow", {
						style: {
							height: px(size.button_height),
							"lineHeight": px(size.button_height),
						},
					},
					[renderStatusIcon(a), `${a.address.name || ""} ${a.address.address}`]
				),
				isOwnEvent
					? m(ButtonN, {
						label: "delete_action",
						type: ButtonType.Action,
						icon: () => Icons.Cancel,
						click: () => {
							remove(attendees, a)
						}
					})
					: null
			]))
		])
	}

	function deleteEvent() {
		if (existingEvent == null) {
			return
		}
		let p = existingEvent.repeatRule
			? Dialog.confirm("deleteRepeatingEventConfirmation_msg")
			: Promise.resolve(true)
		p.then((answer) => {
			if (answer) {
				if (isOwnEvent && existingEvent.attendees.length) {
					sendCalendarCancellation(existingEvent, existingEvent.attendees.map(a => a.address))
				}
				erase(existingEvent).catch(NotFoundError, noOp)
				dialog.close()
			}
		})
	}

	function renderOrganizer(): Children {
		return m(DropDownSelectorN, {
			label: "organizer_label",
			items: mailAddresses
				.map(mailAddress => ({
					name: mailAddress,
					value: mailAddress
				})),
			selectedValue: organizer,
			dropdownWidth: 300,
			disabled: !isOwnEvent || !!existingEvent
		})
	}

	function renderEditing() {
		return [
			m(".flex", [
				m(".flex.flex-half.pr-s", [
					m(".mr-s.flex-grow", m(startDatePicker)),
					!allDay()
						? m(".time-field", m(TimePicker, {
							value: startTime,
							onselected: onStartTimeSelected,
							amPmFormat: amPmFormat,
							disabled: readOnly
						}))
						: null
				]),
				m(".flex.flex-half.pl-s", [
					m(".mr-s.flex-grow", m(endDatePicker)),
					!allDay()
						? m(".time-field", m(TimePicker, {
							value: endTime,
							onselected: endTime,
							amPmFormat: amPmFormat,
							disabled: readOnly
						}))
						: null
				]),
			]),
			m(".flex", [
				m(".mt-s", m(CheckboxN, {
					checked: allDay,
					disabled: readOnly,
					label: () => lang.get("allDay_label")
				})),
				m(".flex-grow"),
				m(ExpanderButtonN, {
					label: "guests_label",
					expanded: attendeesExpanded,
				})
			]),
			m(ExpanderPanelN, {
				expanded: attendeesExpanded,
			}, m(".flex", [
				m(".flex.col.flex-half.pr-s", [
					renderInviting(),
					renderAttendees()
				]),
				m(".flex.col.flex-half.pl-s", [
					renderDecision(),
					renderOrganizer(),
				])
			])),
			eventTooOld
				? null
				: m(".flex.mt-s", [
					// Padding big enough so that end date condition bottom label doesn't push content around
					m(".flex.flex-nogrow-shrink-half.pr-s.pb-ml", [
						m(".flex-grow", m(DropDownSelectorN, repeatPickerAttrs)),
						m(".flex-grow.ml-s"
							+ (repeatPickerAttrs.selectedValue() ? "" : ".hidden"), m(DropDownSelectorN, repeatIntervalPickerAttrs)),
					]),
					repeatPickerAttrs.selectedValue()
						? m(".flex.flex-nogrow-shrink-half.pl-s", [
							m(".flex-grow", m(DropDownSelectorN, endTypePickerAttrs)),
							m(".flex-grow.ml-s", renderStopConditionValue()),
						])
						: null
				]),
			m(".flex", [
				readOnly ? null : m(".flex.col.flex-half.pr-s", alarmPickerAttrs.map((attrs) => m(DropDownSelectorN, attrs))),
				m(".flex-half.pl-s", m(DropDownSelectorN, ({
					label: "calendar_label",
					items: calendarArray.map((calendarInfo) => {
						return {name: getCalendarName(calendarInfo.groupInfo, calendarInfo.shared), value: calendarInfo}
					}),
					selectedValue: selectedCalendar,
					icon: BootIcons.Expand,
					disabled: readOnly
				}: DropDownSelectorAttrs<CalendarInfo>))),
			]),
			m(TextFieldN, {
				label: "location_label",
				value: locationValue,
				disabled: readOnly,
				injectionsRight: () => {
					let address = encodeURIComponent(locationValue())
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
			}),
		]
	}

	function renderDecision() {
		return m(DropDownSelectorN, participationDropdownAttrs)
	}

	function renderDialogContent() {
		return m(".calendar-edit-container.pb", [
			m(TextFieldN, {
				label: "title_placeholder",
				value: summary,
				disabled: readOnly,
				class: "big-input pt"
			}),
			renderEditing(),
			m(descriptionEditor),
			existingEvent && existingEvent._id && !readOnly
				? m(".mr-negative-s.float-right.flex-end-on-child", m(ButtonN, {
					label: "delete_action",
					type: ButtonType.Primary,
					click: () => deleteEvent()
				}))
				: null,
		])
	}

	const dialog = Dialog.largeDialog(
		{
			left: [{label: "cancel_action", click: () => dialog.close(), type: ButtonType.Secondary}],
			right: [{label: "ok_action", click: () => okAction(dialog), type: ButtonType.Primary}],
			middle: () => lang.get("createEvent_label"),
		},
		{view: renderDialogContent}
	)
	dialog.show()
}

function createCalendarAlarm(identifier: string, trigger: string): AlarmInfo {
	const calendarAlarmInfo = createAlarmInfo()
	calendarAlarmInfo.alarmIdentifier = identifier
	calendarAlarmInfo.trigger = trigger
	return calendarAlarmInfo
}


function createRepeatingDatePicker(disabled: boolean): DropDownSelectorAttrs<?RepeatPeriodEnum> {
	const repeatValues = [
		{name: lang.get("calendarRepeatIntervalNoRepeat_label"), value: null},
		{name: lang.get("calendarRepeatIntervalDaily_label"), value: RepeatPeriod.DAILY},
		{name: lang.get("calendarRepeatIntervalWeekly_label"), value: RepeatPeriod.WEEKLY},
		{name: lang.get("calendarRepeatIntervalMonthly_label"), value: RepeatPeriod.MONTHLY},
		{name: lang.get("calendarRepeatIntervalAnnually_label"), value: RepeatPeriod.ANNUALLY}
	]

	return {
		label: "calendarRepeating_label",
		items: repeatValues,
		selectedValue: stream(repeatValues[0].value),
		icon: BootIcons.Expand,
		disabled
	}
}

const intervalValues = numberRange(1, 256).map(n => {
	return {name: String(n), value: n}
})


function createIntervalPicker(disabled: boolean): DropDownSelectorAttrs<number> {
	return {
		label: "interval_title",
		items: intervalValues,
		selectedValue: stream(intervalValues[0].value),
		icon: BootIcons.Expand,
		disabled
	}
}

function createEndTypePicker(disabled: boolean): DropDownSelectorAttrs<EndTypeEnum> {
	const stopConditionValues = [
		{name: lang.get("calendarRepeatStopConditionNever_label"), value: EndType.Never},
		{name: lang.get("calendarRepeatStopConditionOccurrences_label"), value: EndType.Count},
		{name: lang.get("calendarRepeatStopConditionDate_label"), value: EndType.UntilDate}
	]

	return {
		label: () => lang.get("calendarRepeatStopCondition_label"),
		items: stopConditionValues,
		selectedValue: stream(stopConditionValues[0].value),
		icon: BootIcons.Expand,
		disabled
	}
}

export function createEndCountPicker(): DropDownSelectorAttrs<number> {
	return {
		label: "emptyString_msg",
		items: intervalValues,
		selectedValue: stream(intervalValues[0].value),
		icon: BootIcons.Expand,
	}
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

	const invitePeopleValueTextField = new BubbleTextField("shareWithEmailRecipient_label", new MailAddressBubbleHandler({
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

	}))
	return invitePeopleValueTextField
}