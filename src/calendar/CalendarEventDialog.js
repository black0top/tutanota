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
import {findAndRemove, last, numberRange, remove} from "../api/common/utils/ArrayUtils"
import {incrementByRepeatPeriod} from "./CalendarModel"
import {DateTime} from "luxon"
import type {AlarmInfo} from "../api/entities/sys/AlarmInfo"
import {createAlarmInfo} from "../api/entities/sys/AlarmInfo"
import {logins} from "../api/main/LoginController"
import {
	assignEventId,
	calendarAttendeeStatusDescription,
	createRepeatRuleWithValues,
	filterInt,
	generateUid,
	getAllDayDateUTCFromZone,
	getCalendarName,
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
import {isAllDayEvent} from "../api/common/utils/CommonCalendarUtils"
import {NotFoundError} from "../api/common/error/RestError"
import {TimePicker} from "../gui/base/TimePicker"
import {createRecipientInfo, getDefaultSenderFromUser, getDisplayText, getEnabledMailAddresses} from "../mail/MailUtils"
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
	+location: Stream<string>;
	+note: Stream<string>;
	+amPmFormat: bool;
	+existingEvent: ?CalendarEvent
	_oldStartTime: ?string;
	+_zone: string;

	constructor(date: Date, calendars: Map<Id, CalendarInfo>, mailboxDetail: MailboxDetail, existingEvent?: CalendarEvent) {
		this.summary = stream("")
		this.calendars = Array.from(calendars.values())
		this.selectedCalendar = stream(this.calendars[0])
		this.attendees = existingEvent && existingEvent.attendees.slice() || []
		this.organizer = existingEvent && existingEvent.organizer || getDefaultSenderFromUser()
		this.location = stream("")
		this.note = stream("")
		this.allDay = stream(true)
		this.amPmFormat = logins.getUserController().userSettingsGroupRoot.timeFormat === TimeFormat.TWELVE_HOURS
		this.existingEvent = existingEvent
		this._zone = getTimeZone()
		this.startDate = getStartOfDayWithZone(date, this._zone)
		this.endDate = getStartOfDayWithZone(date, this._zone)

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
				this.repeat = {
					frequency: downcast(existingRule.frequency),
					interval: Number(existingRule.interval),
					endType: downcast(existingRule.endType),
					endValue: existingRule.endType === EndType.Count ? Number(existingRule.endValue) : 1,
				}
				// TODO end type date
				// if (existingRule.endType === EndType.UntilDate) {
				// 	const rawEndDate = new Date(Number(existingRule.endValue))
				// 	const localDate = allDay() ? getAllDayDateForTimezone(rawEndDate, zone) : rawEndDate
				// 	// Shown date is one day behind the actual end (for us it's excluded)
				// 	const shownDate = incrementByRepeatPeriod(localDate, RepeatPeriod.DAILY, -1, zone)
				// 	repeatEndDatePicker.setDate(shownDate)
				// } else {
				// 	repeatEndDatePicker.setDate(null)
				// }
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
	const user = logins.getUserController().user
	let calendarArray = Array.from(calendars.values())
	let readOnly = false
	const mailAddresses = getEnabledMailAddresses(mailboxDetail)
	const attendees = existingEvent && existingEvent.attendees.slice() || []
	const organizer = stream(existingEvent && existingEvent.organizer || getDefaultSenderFromUser())
	const isOwnEvent = mailAddresses.includes(organizer())
	// TODO: this should change dynamically depending on the selected calendar
	let canModifyGuests = isOwnEvent
	let canModifyOwnAttendance = true

	if (!existingEvent) {
		calendarArray = calendarArray.filter(calendarInfo => hasCapabilityOnGroup(user, calendarInfo.group, ShareCapability.Write))
	} else {
		// OwnerGroup is not set for invites
		const calendarInfoForEvent = existingEvent._ownerGroup && calendars.get(existingEvent._ownerGroup)
		if (calendarInfoForEvent) {
			readOnly = !hasCapabilityOnGroup(logins.getUserController().user, calendarInfoForEvent.group, ShareCapability.Write)
				|| calendarInfoForEvent.shared && attendees.length > 0
			canModifyGuests = isOwnEvent && !calendarInfoForEvent.shared
			canModifyOwnAttendance = !calendarInfoForEvent.shared
		}
	}

	const viewModel = new EventViewModel(date, calendars, mailboxDetail, existingEvent)

	const startOfTheWeekOffset = getStartOfTheWeekOffsetForUser()
	const startDatePicker = new DatePicker(startOfTheWeekOffset, "dateFrom_label", "emptyString_msg", true, readOnly)
	const endDatePicker = new DatePicker(startOfTheWeekOffset, "dateTo_label", "emptyString_msg", true, readOnly)
	startDatePicker.date.map(viewModel.onStartDateSelected)
	endDatePicker.date.map(viewModel.onEndDateSelected)

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

	endTypePickerAttrs.selectedValue.map((endType) => {
		if (endType === EndType.UntilDate && !repeatEndDatePicker.date()) {
			const newRepeatEnd = incrementByRepeatPeriod(neverNull(startDatePicker.date()), neverNull(repeatPickerAttrs.selectedValue()),
				neverNull(repeatIntervalPickerAttrs.selectedValue()), DateTime.local().zoneName)
			repeatEndDatePicker.setDate(newRepeatEnd)
		}
	})

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
		if (viewModel.onOkPressed()) {
			dialog.close()
		}
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

	const renderInviting = (): Children => canModifyGuests ? m(attendeesField) : null

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
			canModifyGuests
				? m(ButtonN, {
					label: "delete_action",
					type: ButtonType.Action,
					icon: () => Icons.Cancel,
					click: () => {
						remove(attendees, a)
					}
				})
				: null
		])

		return m(".pt-s", attendees.map(renderGuest))
	}

	function renderOrganizer(): Children {
		const disabled = readOnly || attendees.length > 0
		const items = []
		const selectedOrganizer = existingEvent && existingEvent.organizer
		if (selectedOrganizer) {
			items.push({name: selectedOrganizer, value: selectedOrganizer})
		}
		if (!disabled) {
			mailAddresses.forEach((mailAddress) => {
				if (mailAddress !== selectedOrganizer) {
					items.push({name: mailAddress, value: mailAddress})
				}
			})
		}
		return m(DropDownSelectorN, {
			label: "organizer_label",
			items,
			selectedValue: organizer,
			dropdownWidth: 300,
			disabled,
		})
	}

	const renderGoingSelector = () => m(DropDownSelectorN, Object.assign({}, participationDropdownAttrs, {disabled: !canModifyOwnAttendance}))

	const renderDateTimePickers = () => renderTwoColumnsIfFits(
		[
			m(".mr-s.flex-grow", m(startDatePicker)),
			!viewModel.allDay()
				? m(".time-field", m(TimePicker, {
					value: viewModel.startTime,
					onselected: viewModel.onStartTimeSelected,
					amPmFormat: viewModel.amPmFormat,
					disabled: readOnly
				}))
				: null
		],
		[
			m(".mr-s.flex-grow", m(endDatePicker)),
			!viewModel.allDay()
				? m(".time-field", m(TimePicker, {
					value: viewModel.endTime,
					onselected: viewModel.onEndTimeSelected,
					amPmFormat: viewModel.amPmFormat,
					disabled: readOnly
				}))
				: null
		]
	)

	const renderLocationField = () => m(TextFieldN, {
		label: "location_label",
		value: viewModel.location,
		disabled: readOnly,
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
			items: calendarArray.map((calendarInfo) => {
				return {name: getCalendarName(calendarInfo.groupInfo, calendarInfo.shared), value: calendarInfo}
			}),
			selectedValue: viewModel.selectedCalendar,
			icon: BootIcons.Expand,
			disabled: readOnly
		}: DropDownSelectorAttrs<CalendarInfo>)))
	}

	const renderRepeatRulePicker = () => renderTwoColumnsIfFits([
			m(".flex-grow", m(DropDownSelectorN, repeatPickerAttrs)),
			m(".flex-grow.ml-s"
				+ (repeatPickerAttrs.selectedValue() ? "" : ".hidden"), m(DropDownSelectorN, repeatIntervalPickerAttrs)),
		],
		repeatPickerAttrs.selectedValue()
			? [
				m(".flex-grow", m(DropDownSelectorN, endTypePickerAttrs)),
				m(".flex-grow.ml-s", renderStopConditionValue()),
			]
			: null
	)

	function renderEditing() {
		startDatePicker.setDate(viewModel.startDate)
		endDatePicker.setDate(viewModel.endDate)

		return [
			renderDateTimePickers(),
			m(".flex.items-center", [
				m(CheckboxN, {
					checked: viewModel.allDay,
					disabled: readOnly,
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
				readOnly ? null : m(".flex.col.flex-half.pr-s", alarmPickerAttrs.map((attrs) => m(DropDownSelectorN, attrs))),
				renderCalendarPicker(),
			]),
			renderLocationField(),
		]
	}

	const moreButtonActions = () => [
		{
			label: "delete_action",
			type: ButtonType.Dropdown,
			icon: () => Icons.Trash,
			click: () => {viewModel.deleteEvent()}
		}
	]

	const renderMoreButton = () => (existingEvent && existingEvent._id && !readOnly)
		? m(".mr-negative-s", m(ButtonN, attachDropdown({
			label: "more_label",
			icon: () => Icons.More,
		}, moreButtonActions)))
		: null

	function renderDialogContent() {
		return m(".calendar-edit-container.pb", [
			m(".flex.items-end", [
				m(TextFieldN, {
					label: "title_placeholder",
					value: viewModel.summary,
					disabled: readOnly,
					class: "big-input pt flex-grow mr-s"
				}),
				renderMoreButton(),
			]),
			renderEditing(),
			m(descriptionEditor),
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
