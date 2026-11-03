# Money Jars

A kid-friendly money tracker. Every gift is split into four jars, and parents add a one-time bonus.

| Jar | Gift split (default) | Parent match |
|---|---|---|
| 🛍️ Spend | 25% | none |
| 🐷 Save | 25% | +25% |
| 🌱 Invest | 25% | +100% |
| 🎁 Gift | 25% | +50% |

All percentages are editable in **Settings**.

## Rules built in

- **Gifts** are split by the fixed percentages above and matched once.
- **Earned money** is split however the kid chooses. All-to-Spend is allowed but shows a nudge about the bonus they'd miss. Matching earned money is on by default and can be turned off.
- **Kid money vs. parent money** is tracked separately in every jar. When money leaves a jar, it comes out of both in proportion to what each put in.
- **Spend, Gift and Invest** spending always needs a note. Invest spending also needs a reason from the approved list: education, books, classes, business ideas, lemonade stands, prototypes and so on.
- **Save works like a bank.**
  - Earns monthly interest, 4% a year by default, paid by the parent.
  - Money can come out once per quarter, up to 30% of the jar.
  - Milestones ($100, $250, $500, $1,000 and up) lock in for good once reached.
- **Birthday saver bonus.** On each birthday the parent adds 10% of what the kid put into Save that year, minus what they took out. Taking nothing out adds another 5%.
- **Moving money between jars** never earns a new bonus. Moves out of Save follow the Save rules. Moves out of Invest or Gift are flagged. A parent can override any rule with a checkbox.
- **Invest value.** If Invest money sits in a real account, enter its current value and gains or losses are shared by ownership.
- **Parent PIN** is optional. With it, kids can look at everything but can't change anything.

## Running it

**Option 1. Phone and computer, installable.** Host the folder on GitHub Pages, open the link, then:
- iPhone: Share, then Add to Home Screen.
- Android or Chrome: Install app.

It then works offline like a regular app.

**Option 2. Single file.** Download `dist/money-jars.html` and double-click it. Everything is inside that one file. Google Drive one-tap backup does not work from a file; use Download or Share backup instead.

**Option 3. Local server.**
```bash
python3 -m http.server 8080
```

Data is stored on each device in the browser. On iPhone, add it to the Home Screen so Safari doesn't clear the data after weeks of not using it.

## Backups

Settings, then Backup:
- **Download backup** saves a `.json` file. Put it in your Google Drive folder.
- **Share to Drive or Files** (phones) opens the share sheet; pick Google Drive.
- **Restore from file** replaces the data on this device with a backup.
- **Google Drive, one tap** uploads to a `money-jars-backup.json` file in your Drive. It can also back up after every change. Drive keeps older versions of the file automatically.

### Google sign-in setup (once, by the app owner)

Google requires every app that uses Drive to be registered. This is done once. After that, every device just taps **Sign in with Google**.

1. Go to https://console.cloud.google.com and create a project called Money Jars.
2. Enable the **Google Drive API** for that project.
3. Set up the consent screen. Choose External, add yourself as a test user, then publish the app to Production.
4. Create an **OAuth client ID** of type Web application. Add `https://curataservices-bot.github.io` as an Authorized JavaScript origin.
5. Put the client ID in `BUILT_IN_CLIENT_ID` at the top of `app.js`. You can also paste it under Settings, Backup, Advanced on one device.

The app only asks for the `drive.file` permission, so it can see only the files it created. Each sign-in lasts about an hour. After that, a banner offers a one-tap reconnect when there are new changes.

## Development

```bash
npm test
```

```bash
npm run build
```

`core.js` holds all money rules as pure functions and is fully unit-tested. `app.js` is the interface. No frameworks and no build step are needed to run it.

## If this becomes a public product

Backups would move from Drive files to a hosted database with real accounts and sync, such as Supabase or Firebase. Kid logins and parental consent rules for children under 13 would also apply.
