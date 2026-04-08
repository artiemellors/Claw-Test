import Contacts
import EventKit
import SwiftUI
import UIKit

struct PrivacyAccessSectionView: View {
    @State private var contactsStatus: CNAuthorizationStatus = CNContactStore.authorizationStatus(for: .contacts)
    @State private var calendarStatus: EKAuthorizationStatus = EKEventStore.authorizationStatus(for: .event)
    @State private var remindersStatus: EKAuthorizationStatus = EKEventStore.authorizationStatus(for: .reminder)

    @Environment(\.scenePhase) private var scenePhase

    private enum PermissionStatusKind {
        case allowed
        case notSet
        case limited
        case disallowed
        case unknown

        var color: Color {
            switch self {
            case .allowed: return .green
            case .notSet: return .orange
            case .limited: return .yellow
            case .disallowed, .unknown: return .red
            }
        }
    }

    var body: some View {
        DisclosureGroup("Privacy & Access") {
            permissionRow(
                title: "Contacts",
                icon: "person.crop.circle",
                status: statusText(for: contactsStatus),
                statusKind: permissionStatusKind(for: contactsStatus),
                detail: "Search and add contacts from the assistant.",
                actionTitle: actionTitle(for: contactsStatus),
                action: handleContactsAction
            )

            permissionRow(
                title: "Calendar (Add Events)",
                icon: "calendar.badge.plus",
                status: calendarWriteStatusText,
                statusKind: calendarWriteStatusKind,
                detail: "Add events with least privilege.",
                actionTitle: calendarWriteActionTitle,
                action: handleCalendarWriteAction
            )

            permissionRow(
                title: "Calendar (View Events)",
                icon: "calendar",
                status: calendarReadStatusText,
                statusKind: calendarReadStatusKind,
                detail: "List and read calendar events.",
                actionTitle: calendarReadActionTitle,
                action: handleCalendarReadAction
            )

            permissionRow(
                title: "Reminders",
                icon: "checklist",
                status: remindersStatusText,
                statusKind: remindersStatusKind,
                detail: "List, add, and complete reminders.",
                actionTitle: remindersActionTitle,
                action: handleRemindersAction
            )
        }
        .onAppear { refreshAll() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { refreshAll() }
        }
    }

    // MARK: - Permission Row

    @ViewBuilder
    private func permissionRow(
        title: String,
        icon: String,
        status: String,
        statusKind: PermissionStatusKind,
        detail: String,
        actionTitle: String?,
        action: (() -> Void)?
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(title, systemImage: icon)
                Spacer()
                Text(status)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(statusKind.color)
            }
            Text(detail)
                .font(.footnote)
                .foregroundStyle(.secondary)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .font(.footnote)
                    .buttonStyle(.bordered)
            }
        }
        .padding(.vertical, 2)
    }

    // MARK: - Contacts

    private func statusText(for cnStatus: CNAuthorizationStatus) -> String {
        switch cnStatus {
        case .authorized, .limited: return "Allowed"
        case .notDetermined: return "Not Set"
        case .denied, .restricted: return "Not Allowed"
        @unknown default: return "Unknown"
        }
    }

    private func permissionStatusKind(for cnStatus: CNAuthorizationStatus) -> PermissionStatusKind {
        switch cnStatus {
        case .authorized, .limited: return .allowed
        case .notDetermined: return .notSet
        case .denied, .restricted: return .disallowed
        @unknown default: return .unknown
        }
    }

    private func actionTitle(for cnStatus: CNAuthorizationStatus) -> String? {
        switch cnStatus {
        case .notDetermined: return "Request Access"
        case .denied, .restricted: return "Open Settings"
        default: return nil
        }
    }

    private func handleContactsAction() {
        switch contactsStatus {
        case .notDetermined:
            Task {
                let store = CNContactStore()
                _ = await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
                    store.requestAccess(for: .contacts) { granted, _ in
                        cont.resume(returning: granted)
                    }
                }
                await MainActor.run { refreshAll() }
            }
        case .denied, .restricted:
            openSettings()
        default:
            break
        }
    }

    // MARK: - Calendar Write

    private var calendarWriteStatusText: String {
        switch calendarStatus {
        case .authorized, .fullAccess, .writeOnly: return "Allowed"
        case .notDetermined: return "Not Set"
        case .denied, .restricted: return "Not Allowed"
        @unknown default: return "Unknown"
        }
    }

    private var calendarWriteStatusKind: PermissionStatusKind {
        switch calendarStatus {
        case .authorized, .fullAccess, .writeOnly: return .allowed
        case .notDetermined: return .notSet
        case .denied, .restricted: return .disallowed
        @unknown default: return .unknown
        }
    }

    private var calendarWriteActionTitle: String? {
        switch calendarStatus {
        case .notDetermined: return "Request Access"
        case .denied, .restricted: return "Open Settings"
        default: return nil
        }
    }

    private func handleCalendarWriteAction() {
        switch calendarStatus {
        case .notDetermined:
            Task {
                _ = await requestCalendarFull()
                await MainActor.run { refreshAll() }
            }
        case .denied, .restricted:
            openSettings()
        default:
            break
        }
    }

    // MARK: - Calendar Read

    private var calendarReadStatusText: String {
        switch calendarStatus {
        case .authorized, .fullAccess: return "Allowed"
        case .writeOnly: return "Add-Only"
        case .notDetermined: return "Not Set"
        case .denied, .restricted: return "Not Allowed"
        @unknown default: return "Unknown"
        }
    }

    private var calendarReadStatusKind: PermissionStatusKind {
        switch calendarStatus {
        case .authorized, .fullAccess: return .allowed
        case .writeOnly: return .limited
        case .notDetermined: return .notSet
        case .denied, .restricted: return .disallowed
        @unknown default: return .unknown
        }
    }

    private var calendarReadActionTitle: String? {
        switch calendarStatus {
        case .notDetermined: return "Request Full Access"
        case .writeOnly: return "Upgrade to Full Access"
        case .denied, .restricted: return "Open Settings"
        default: return nil
        }
    }

    private func handleCalendarReadAction() {
        switch calendarStatus {
        case .notDetermined, .writeOnly:
            Task {
                _ = await requestCalendarFull()
                await MainActor.run { refreshAll() }
            }
        case .denied, .restricted:
            openSettings()
        default:
            break
        }
    }

    // MARK: - Reminders

    private var remindersStatusText: String {
        switch remindersStatus {
        case .authorized, .fullAccess: return "Allowed"
        case .writeOnly: return "Add-Only"
        case .notDetermined: return "Not Set"
        case .denied, .restricted: return "Not Allowed"
        @unknown default: return "Unknown"
        }
    }

    private var remindersStatusKind: PermissionStatusKind {
        switch remindersStatus {
        case .authorized, .fullAccess: return .allowed
        case .writeOnly: return .limited
        case .notDetermined: return .notSet
        case .denied, .restricted: return .disallowed
        @unknown default: return .unknown
        }
    }

    private var remindersActionTitle: String? {
        switch remindersStatus {
        case .notDetermined: return "Request Access"
        case .writeOnly: return "Upgrade to Full Access"
        case .denied, .restricted: return "Open Settings"
        default: return nil
        }
    }

    private func handleRemindersAction() {
        switch remindersStatus {
        case .notDetermined, .writeOnly:
            Task {
                _ = await requestRemindersFull()
                await MainActor.run { refreshAll() }
            }
        case .denied, .restricted:
            openSettings()
        default:
            break
        }
    }

    // MARK: - Helpers

    private func refreshAll() {
        contactsStatus = CNContactStore.authorizationStatus(for: .contacts)
        calendarStatus = EKEventStore.authorizationStatus(for: .event)
        remindersStatus = EKEventStore.authorizationStatus(for: .reminder)
    }

    private func requestCalendarFull() async -> Bool {
        let store = EKEventStore()
        return await withCheckedContinuation { cont in
            store.requestFullAccessToEvents { granted, _ in
                cont.resume(returning: granted)
            }
        }
    }

    private func requestRemindersFull() async -> Bool {
        let store = EKEventStore()
        return await withCheckedContinuation { cont in
            store.requestFullAccessToReminders { granted, _ in
                cont.resume(returning: granted)
            }
        }
    }

    private func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }
}
