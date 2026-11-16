# SnipBoard

One-click copy board for an operations team. Save pieces of information (company name, address,
tax numbers, bank details) in folders, then copy any of them with a single click.

Runs on **Windows** (installer `.exe`) and **Android** (`.apk`). Works fully offline. Each device
keeps its own data.

## What it does

A **tablet** is one unit of information: a name plus the text that gets copied. Tablets live in folders.

- **One-click copy** of any tablet, pasted wherever you need it. A bar at the bottom always shows
  what was copied last.
- **Folders inside folders** to keep tablets arranged; rename, move and delete folders and tablets.
- **Copy styles**: Normal, BIG (all capital), small, First capital, Each Word, Italic
  (real italic for Word / Outlook / Gmail / Excel) and Italic ✱ (italic-looking letters that paste anywhere).
- **Text tools** tab to convert any typed or pasted text.
- **Search** across every folder.
- **Two app passwords**: Admin can add, edit, rename and delete. Operator can only view and copy.
- **Every tablet is encrypted on its own** (AES-256), inside an encrypted data file.
- **Password on any tablet or folder** (optional). A password tablet is encrypted with that password;
  a password folder encrypts every tablet inside it and hides its contents until unlocked.
  These passwords cannot be recovered if forgotten.
- **Hidden tablets** show dots on screen and are cleared from the clipboard after a set time.
- **Auto-lock** after a set idle time.
- **Mini window** (Windows) that stays on top of other programs.
- **Backup / restore** to an encrypted file, **import from Excel or CSV**, export to CSV.

Import sheet columns: `Folder | Name | Value | Sensitive`. Folder can be a path such as
`Company / Bank`. Download a sample from Settings.

## Build

Requires Node.js 20+.

```bash
npm install
npm start            # run the desktop app
npm test             # unit tests
npm run test:e2e     # end-to-end test of the desktop app (Linux, needs xvfb)
npm run dist:win     # Windows installer -> dist/SnipBoard-Setup-1.1.0.exe
npm run android:apk  # Android APK -> android/app/build/outputs/apk/debug/app-debug.apk
```

`dist:win` runs on Windows directly, or on Linux with Wine (`wine` + `wine32`) installed.
`android:apk` needs JDK 17+ and the Android SDK (platform 34) with `ANDROID_HOME` set.

The installer and APK are not code-signed. Windows SmartScreen shows "Unknown publisher"
(choose More info > Run anyway) and Android asks to allow installing from unknown sources.

## Layout

```
www/        the app itself (HTML, CSS, JavaScript; no framework, no build step)
electron/   Windows shell: window, clipboard, file storage
android/    Android shell (Capacitor)
tests/      unit and end-to-end tests
```
