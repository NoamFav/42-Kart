# 42 Kart

The 42 common core as a live kart race between friends. One estimated hour of work is one kilometre of track, so heavy projects move you further than light ones. From above, the circuit draws the digits 42.

Unofficial, made by students for students.

## How it plays

- **Create a race**, send the link, everyone builds a kart and picks a PIN. The PIN gets your kart back on another device.
- **Pit** (P): log what you are on. Work in progress moves you up to 90% of a project. The last stretch only opens with a validation.
- **Validate** and everyone online sees it live: banner, boost, confetti, overtakes. Grades above 100 count as tiebreak bonus.
- **Items** are earned by validating, plus one a day. They are cosmetic and never change anyone's distance. The further back you are, the meaner the box.
- **Drive** puts you on the real track with whoever else is online. You can only go as far as you have earned, and your validated gates are boost pads.
- **The Black Hole** moves at the pace of your deadline. Stay ahead of it. Set the date in race settings.
- **Map** (M) shows the real branching curriculum and who is where. **Season replay** (in settings) plays the whole race back in 16 seconds.

Anyone with the link can watch without joining. Progress is on the honour system, and the feed has a 🤨 button for that.

## Run it locally

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173. To fill a race with bots while `pnpm dev` is running:

```bash
pnpm demo
```

Tests: `pnpm test`. Data lives in `./data/kart.db`.

## Deploy to Fly

One Node process with SQLite on a volume. The machine suspends when nobody is connected.

Keep it to **one machine**: the database is a file on its volume, so a second machine would be a second, separate race.

```bash
fly auth login
fly apps create your-app-name
```

Set `app = "your-app-name"` in `fly.toml`, then:

```bash
fly volumes create kart_data --region cdg --size 1 --yes
fly deploy --ha=false
```

## Changing the curriculum

Everything lives in `shared/curriculum.ts`. Change a project's `km` and the track, gates and scoring follow.

Assumptions worth checking there:

- Exams have no hours on the slide, so their distances (20 to 50 km) are invented.
- Python Piscine is 70h on the slide, split across its 11 steps by hand.
- The slide's Network Programming header says 230h but its boxes add up to 220h. The boxes win.
- Agent Smith and free_rify share one 100h slot, which is the only way the AI module reaches 330h.
- push_swap is listed in two modules and counted once, so the race is 1,870 km.
