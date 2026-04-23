# SYSTEM CONTEXT — WhatsApp Medical Consultation Pipeline

## Project Overview
Build a WhatsApp-native backend that connects three parties — Doctor, Patient, and Pharmacy —
through a single WhatsApp Business number. The backend proxies messages between doctor and
patient, then dispatches a structured prescription to the pharmacy at the end of the consultation.

The pharmacy must never receive any consultation conversation content. Only a structured
prescription payload is shared with them.

---

## Architecture Summary

```
Patient ──┐
          ├──► [Your WA Hub Number] ──► Backend (Node.js) ──► Doctor
Doctor ───┘                                    │
                                               │ (on prescription confirmed)
                                               ▼
                                          Pharmacy (prescription only)
                                               │
                                               ▼
                                          Patient (reference code + confirmation)
```

- All three parties interact via WhatsApp only. No app, no portal, no web UI.
- Backend is the sole broker. It routes messages and enforces privacy boundaries.
- One WhatsApp Business number acts as the hub for all parties.

---

## WhatsApp API
- Provider: **Gupshup (interim BSP)** — will switch to Meta Cloud API direct in production
- Gupshup Docs: https://docs.gupshup.io/docs/whatsapp-api-documentation
- Webhook: POST `/webhook` — receives all inbound messages from Gupshup
- Send API: POST `https://api.gupshup.io/sm/api/v1/msg`
- Auth: API key via `GUPSHUP_API_KEY` env variable
- Source (your WA number): via `GUPSHUP_SOURCE_NUMBER` env variable
- App Name: via `GUPSHUP_APP_NAME` env variable

### Switching to Meta Cloud API later (production)
The `whatsappService.js` module must abstract all API calls behind these functions:
`sendText(to, message)`, `sendButtons(to, bodyText, buttons)`, `sendTemplate(to, templateName, params)`
Swapping providers = only rewriting `whatsappService.js`. No other module changes.

### Gupshup vs Meta API shape difference to account for:
- Gupshup inbound webhook payload wraps message in `payload.payload` — messageParser.js must handle this
- Gupshup send API uses form-encoded body, not JSON — whatsappService.js must use `application/x-www-form-urlencoded`
- Interactive buttons in Gupshup use `type: "quick_reply"` inside a JSON stringified `msg` param

---

## Environment Variables (create a .env file)
```
# Gupshup (interim BSP)
GUPSHUP_API_KEY=
GUPSHUP_SOURCE_NUMBER=     # Your WA business number on Gupshup, e.g. 919XXXXXXXXX
GUPSHUP_APP_NAME=          # App name as created on Gupshup dashboard

# Roles
DOCTOR_WA_NUMBER=          # Doctor's WhatsApp number with country code, e.g. 919XXXXXXXXX
PHARMACY_WA_NUMBER=        # Pharmacy's WhatsApp number with country code
PHARMACY_NAME=             # e.g. "MedPlus Anna Nagar"
DOCTOR_NAME=               # e.g. "Dr. K. Mehta"
DOCTOR_REG_NUMBER=         # e.g. "MCI-XXXXX"
PORT=3000

# --- Future: Meta Cloud API direct (uncomment when switching) ---
# WHATSAPP_TOKEN=
# WHATSAPP_PHONE_NUMBER_ID=
# WHATSAPP_VERIFY_TOKEN=
```

---

## Session State Model
Use an in-memory store for now, abstracted behind a `sessionStore` module so it can be
swapped to Redis or PostgreSQL later without changing any other module.

Each session object:
```json
{
  "sessionId": "uuid-v4",
  "patientNumber": "919XXXXXXXXX",
  "state": "INTAKE | ACTIVE | PRESCRIBING | COMPLETE",
  "intakeData": {
    "name": "",
    "age": "",
    "symptoms": ""
  },
  "prescription": {
    "medicines": [],
    "currentMedicine": {},
    "referenceCode": ""
  },
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp"
}
```

States:
- `INTAKE` — bot is collecting patient name, age, symptoms
- `ACTIVE` — doctor and patient are in proxied live chat
- `PRESCRIBING` — doctor has triggered prescription, guided button flow is in progress
- `COMPLETE` — prescription dispatched, session closed

---

## Message Routing Logic

### Inbound message from Patient (number matches no active session OR state=INTAKE):
→ Run intake flow (collect name, age, symptoms sequentially)
→ Once intake complete, notify doctor with patient summary
→ Set state to ACTIVE

### Inbound message from Patient (state=ACTIVE):
→ Forward message to DOCTOR_WA_NUMBER with prefix "[Patient]:"

### Inbound message from Doctor (state=ACTIVE):
→ Forward message to patient's number with prefix "[Doctor]:"

### Inbound message from Doctor — text is "done" or "end" or "finish" (case-insensitive, state=ACTIVE):
→ Set state to PRESCRIBING
→ Send doctor a WhatsApp Interactive Button message to confirm prescription start

### Inbound message from Doctor (state=PRESCRIBING):
→ Handle guided prescription form (see Prescription Flow below)

### Inbound message from Pharmacy:
→ Extract reference code from message if present
→ Forward to corresponding patient number
→ Do NOT log or expose any session/conversation data to pharmacy

---

## Prescription Trigger Flow (WhatsApp Button Guided)

When doctor sends "done"/"end"/"finish", send this Interactive Button message to doctor:

```
"Ready to send prescription to [PHARMACY_NAME]?"
Buttons: ["Yes, start prescription"] ["No, continue chat"]
```

If doctor taps "Yes, start prescription":
→ Ask sequentially via plain text prompts (one question at a time):

  Step 1: "Medicine name and strength? (e.g. Paracetamol 500mg)"
  Step 2: "Dosage and frequency? (e.g. 1 tab twice daily)"
  Step 3: "Duration? (e.g. 3 days)"
  Step 4: Send buttons — ["+ Add another medicine"] ["✓ Done, send prescription"]

Repeat steps 1-4 for each medicine added.

When doctor taps "✓ Done, send prescription":
→ Show prescription summary to doctor as a text message
→ Send buttons — ["✓ Confirm & Send"] ["✎ Edit (start over)"]

On "✓ Confirm & Send":
→ Generate reference code (format: RX-XXXX, 4 random uppercase alphanumeric)
→ Dispatch prescription to pharmacy
→ Send confirmation to patient
→ Set session state to COMPLETE

---

## Prescription Payload (sent to pharmacy)

STRICT RULE: This payload must contain ZERO conversation content, symptom descriptions,
or any data from the INTAKE or ACTIVE states. Only the following fields:

```
"New Prescription | {referenceCode}"
"Patient: {intakeData.name} | Contact: {patientNumber}"
"──────────────────────────"
For each medicine:
"{index}. {medicineName} — {dosage} — {duration}"
"──────────────────────────"
"{DOCTOR_NAME} | Reg: {DOCTOR_REG_NUMBER}"
"Date: {today's date}"
```

---

## Patient Confirmation Message (sent after dispatch)

```
"✓ Consultation complete!
Your prescription has been sent to {PHARMACY_NAME}.
Reference code: {referenceCode}
They will contact you shortly with availability and offers.
Show this code at the counter: {referenceCode}"
```

---

## Module Structure
```
/src
  /routes
    webhook.js          # Express route — handles GET (verification) and POST (inbound messages)
  /handlers
    patientHandler.js   # Handles all inbound logic for patient-side messages
    doctorHandler.js    # Handles all inbound logic for doctor-side messages
    pharmacyHandler.js  # Handles inbound messages from pharmacy (forwards to patient only)
  /services
    whatsappService.js  # Wrapper for Meta Cloud API — sendText, sendButtons, sendList
    prescriptionService.js  # Prescription parser, reference code generator, dispatch logic
    sessionStore.js     # In-memory store abstraction (get, set, delete, getByPatient)
  /utils
    messageParser.js    # Extracts message type, body, sender from Meta webhook payload
    referenceCode.js    # Generates RX-XXXX codes
  index.js              # Express app entry point
  .env                  # Environment variables (never commit)
  .env.example          # Template with all keys, no values
```

---

## Privacy Rules (enforce in code review / Mission 5)
1. `pharmacyHandler.js` must never import or reference `sessionStore` for read operations
   beyond looking up the patient number by reference code.
2. The prescription payload builder in `prescriptionService.js` must only accept the
   typed `PrescriptionPayload` object — it must not accept a full session object.
3. Conversation message logs (if added later) must live in a separate store/table
   with no foreign key or reference accessible from the pharmacy dispatch path.

---

## Tech Stack
- Runtime: Node.js (v20+)
- Framework: Express.js
- WhatsApp API: Gupshup BSP (interim) — abstracted in whatsappService.js for easy provider swap
- Storage: In-memory (abstracted via sessionStore.js)
- Language: JavaScript (ESModules or CommonJS, your choice — be consistent)
- No frontend. No database setup required for v1.

---

## Test Numbers (fill before Mission 6)
```
DOCTOR_TEST_NUMBER=
PATIENT_TEST_NUMBER=
PHARMACY_TEST_NUMBER=
```

---

## Out of Scope for v1
- Authentication / login for doctor
- Prescription PDF generation (plain WhatsApp text message is sufficient for v1)
- Multi-doctor routing
- Appointment scheduling
- Payment collection
- Conversation history persistence
- Multi-language support

These can be added in later missions once the core flow is stable.

---

## Mission Sequence (execute in order)

| # | Mission | Key output |
|---|---------|------------|
| 1 | Project scaffold | Folder structure, Express server, .env setup |
| 2 | Gupshup webhook setup | Verified webhook, message receiver, messageParser |
| 3 | Session store + routing logic | sessionStore.js, patientHandler, doctorHandler stubs |
| 4 | Intake flow | Full patient intake (name, age, symptoms), doctor notification |
| 5 | Proxied chat | Bidirectional message forwarding between doctor and patient |
| 6 | Prescription button flow | Guided form, summary, confirm/edit buttons |
| 7 | Prescription dispatch | prescriptionService, pharmacy message, patient confirmation |
| 8 | Pharmacy handler | Inbound from pharmacy → forward to patient |
| 9 | Privacy audit | Confirm no conversation data leaks to pharmacy path |
| 10 | End-to-end test simulation | Scripted test covering full flow with all 3 test numbers |