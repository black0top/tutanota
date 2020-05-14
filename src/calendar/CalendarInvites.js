//@flow

import {mailModel} from "../mail/MailModel"
import {calendarAttendeeStatusSymbol, formatEventDuration, getTimeZone} from "./CalendarUtils"
import {theme} from "../gui/theme"
import {stringToUtf8Uint8Array, uint8ArrayToBase64} from "../api/common/utils/Encoding"
import type {CalendarAttendeeStatusEnum, CalendarMethodEnum} from "../api/common/TutanotaConstants"
import {CalendarMethod, getAttendeeStatus, IcalendarCalendarMethod} from "../api/common/TutanotaConstants"
import {makeInvitationCalendarFile, parseCalendarFile} from "./CalendarImporter"
import {MailEditor} from "../mail/MailEditor"
import {worker} from "../api/main/WorkerClient"
import {showCalendarEventDialog} from "./CalendarEventDialog"
import m from "mithril"
import {DateTime} from "luxon"
import {Dialog} from "../gui/base/Dialog"
import type {CalendarEvent} from "../api/entities/tutanota/CalendarEvent"
import type {AlarmInfo} from "../api/entities/sys/AlarmInfo"
import {lang} from "../misc/LanguageViewModel"
import type {MailAddress} from "../api/entities/tutanota/MailAddress"
import type {File as TutanotaFile} from "../api/entities/tutanota/File"
import {loadCalendarInfos} from "./CalendarModel"
import type {EncryptedMailAddress} from "../api/entities/tutanota/EncryptedMailAddress"


export function sendCalendarInvite(existingEvent: CalendarEvent, alarms: Array<AlarmInfo>, recipients: $ReadOnlyArray<EncryptedMailAddress>) {
	return mailModel.getUserMailboxDetails().then((mailboxDetails) => {
		if (existingEvent.organizer == null) {
			throw new Error("Cannot send invite if organizer is not sent")
		}

		const editor = new MailEditor(mailboxDetails)
		const message = lang.get("eventInviteMail_msg", {"{event}": existingEvent.summary})
		const bcc = recipients.map(({name, address}) => ({name, address}))
		editor.initWithTemplate(
			{bcc},
			message,
			makeInviteEmailBody(existingEvent, message),
			/*confidential*/false
		)
		const inviteFile = makeInvitationCalendarFile(existingEvent, IcalendarCalendarMethod.REQUEST, new Date(), getTimeZone())
		sendCalendarFile(editor, inviteFile, CalendarMethod.REQUEST)
	})
}

export function sendCalendarInviteResponse(event: CalendarEvent, sender: MailAddress, status: CalendarAttendeeStatusEnum) {
	const {organizer} = event
	if (organizer == null) {
		return Promise.reject(new Error("Cannot send calendar invitation response without organizer"))
	}
	mailModel.getUserMailboxDetails().then((mailboxDetails) => {
		const editor = new MailEditor(mailboxDetails)
		const message = lang.get("repliedToEventInvite_msg", {"{sender}": sender.name || sender.address})
		editor.initWithTemplate({to: [{name: "", address: organizer}]},
			message,
			makeResponseEmailBody(event, message, sender, status), false)
		const responseFile = makeInvitationCalendarFile(event, IcalendarCalendarMethod.REPLY, new Date(), getTimeZone())
		sendCalendarFile(editor, responseFile, CalendarMethod.REPLY)
	})
}

export function sendCalendarUpdate(event: CalendarEvent, recipients: $ReadOnlyArray<EncryptedMailAddress>) {
	return mailModel.getUserMailboxDetails().then((mailboxDetails) => {
		const editor = new MailEditor(mailboxDetails)
		const bcc = recipients.map(({name, address}) => ({
			name,
			address
		}))
		editor.initWithTemplate({bcc}, lang.get("eventUpdated_msg", {"{event}": event.summary}),
			makeInviteEmailBody(event, ""))

		const file = makeInvitationCalendarFile(event, IcalendarCalendarMethod.REQUEST, new Date(), getTimeZone())
		sendCalendarFile(editor, file, CalendarMethod.REQUEST)
	})
}

export function sendCalendarCancellation(event: CalendarEvent, recipients: $ReadOnlyArray<EncryptedMailAddress>) {
	return mailModel.getUserMailboxDetails().then((mailboxDetails) => {
		const editor = new MailEditor(mailboxDetails)
		const bcc = recipients.map(({name, address}) => ({
			name,
			address
		}))
		editor.initWithTemplate({bcc}, lang.get("eventCancelled_msg", {"{event}": event.summary}),
			makeInviteEmailBody(event, ""))

		const file = makeInvitationCalendarFile(event, IcalendarCalendarMethod.CANCEL, new Date(), getTimeZone())
		sendCalendarFile(editor, file, CalendarMethod.CANCEL)
	})
}

function sendCalendarFile(editor: MailEditor, responseFile: DataFile, method: CalendarMethodEnum) {
	editor.attachFiles([responseFile])
	editor.hooks = {
		beforeSent(editor: MailEditor, attachments: Array<TutanotaFile>) {
			return {calendarFileMethods: [[attachments[0]._id, method]]}
		}
	}
	editor.send()
}

function organizerLine(event: CalendarEvent) {
	return `<div style="display: flex"><div style="min-width: 80px">${lang.get("who_label")}:</div><div>${
		event.organizer ? `${event.organizer} (${lang.get("organizer_label")})` : ""}</div></div>`
}

function whenLine(event: CalendarEvent): string {
	const duration = formatEventDuration(event, getTimeZone())
	return `<div style="display: flex"><div style="min-width: 80px">${lang.get("when_label")}:</div>${duration}</div>`
}

function makeInviteEmailBody(event: CalendarEvent, message: string) {
	return `<div style="max-width: 685px; margin: 0 auto">
  <h2 style="text-align: center">${message}</h2>
  <div style="margin: 0 auto">
    ${whenLine(event)}
    ${organizerLine(event)}
    ${event.attendees.map((a) =>
		"<div style='margin-left: 80px'>" + (a.address.name || "") + " " + a.address.address + " "
		+ calendarAttendeeStatusSymbol(getAttendeeStatus(a)) + "</div>")
	       .join("\n")}
  </div>
  <hr style="border: 0; height: 1px; background-color: #ddd">
  <img style="max-height: 38px; display: block; background-color: white; padding: 4px 8px; border-radius: 4px; margin: 16px auto 0"
  		src="data:image/svg+xml;base64,${uint8ArrayToBase64(stringToUtf8Uint8Array(theme.logo))}"
  		alt="logo"/>
</div>`
}

function makeResponseEmailBody(event: CalendarEvent, message: string, sender: MailAddress, status: CalendarAttendeeStatusEnum): string {
	return `<div style="max-width: 685px; margin: 0 auto">
  <h2 style="text-align: center">${message}</h2>
  <div style="margin: 0 auto">
  <div style="display: flex">${lang.get("who_label")}:<div style='margin-left: 80px'>${sender.name + " " + sender.address
	} ${calendarAttendeeStatusSymbol(status)}</div></div>
  </div>
  <hr style="border: 0; height: 1px; background-color: #ddd">
  <img style="max-height: 38px; display: block; background-color: white; padding: 4px 8px; border-radius: 4px; margin: 16px auto 0"
  		src="data:image/svg+xml;base64,${uint8ArrayToBase64(stringToUtf8Uint8Array(theme.logo))}"
  		alt="logo"/>
</div>`
}

function loadOrCreateCalendarInfo() {
	return loadCalendarInfos()
		.then((calendarInfo) =>
			calendarInfo.size && calendarInfo || worker.addCalendar("").then(() => loadCalendarInfos()))
}

function getParsedEvent(fileData: DataFile): ?{event: CalendarEvent, uid: string} {
	try {
		const {contents} = parseCalendarFile(fileData)
		const parsedEventWithAlarms = contents[0]
		if (parsedEventWithAlarms && parsedEventWithAlarms.event.uid) {
			return {event: parsedEventWithAlarms.event, uid: parsedEventWithAlarms.event.uid}
		} else {
			return null
		}
	} catch (e) {
		console.log(e)
		return null
	}
}

export function showEventDetailsFromFile(firstCalendarFile: TutanotaFile) {
	worker.downloadFileContent(firstCalendarFile)
	      .then((fileData) => {
		      const parsedEventWithAlarms = getParsedEvent(fileData)
		      if (parsedEventWithAlarms == null) {
			      Dialog.error("cannotOpenEvent_msg")
			      return
		      }
		      const parsedEvent = parsedEventWithAlarms.event
		      return Promise.all([
			      worker.getEventByUid(parsedEventWithAlarms.uid),
			      loadOrCreateCalendarInfo(),
			      mailModel.getUserMailboxDetails(),
		      ]).then(([existingEvent, calendarInfo, mailboxDetails]) => {
			      if (existingEvent) {
				      m.route.set(`/calendar/month/${DateTime.fromJSDate(existingEvent.startTime).toISODate()}`)
				      // It should be the latest version eventually via CalendarEventUpdates
				      showCalendarEventDialog(existingEvent.startTime, calendarInfo, mailboxDetails, existingEvent)
			      } else {
				      showCalendarEventDialog(parsedEvent.startTime, calendarInfo, mailboxDetails, parsedEvent)
			      }
		      })
	      })
}