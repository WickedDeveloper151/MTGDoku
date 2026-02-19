# MTGDoku — Code Explanation

This document explains how the MTGDoku game is built and how the pieces fit together.

---

## What the game does

- You see a **3×3 grid**. Each row and each column has a **criterion** (e.g. "Blue Cards", "Creatures", "Mana Value 3").
- Each **cell** is the intersection of one row and one column. Your job: find a **Magic card** that satisfies **both** that row’s and that column’s criterion.
- You get **6 guesses per cell**. If you fill all 9 cells correctly, you win. If you use 6 wrong guesses on any one cell, you lose.
- **Any** card that matches both criteria counts as correct (no single “answer” per cell).

---

## High-level architecture

```
Browser (index.html + game.js)
    ↓ fetch /api/board?date=YYYY-MM-DD
Server (server.js)
    ↓ db.getPuzzle(date) or generateBoard() + db.savePuzzle()
Database (db.js → mtgdoku.db)
```

- **Frontend**: One main game page (`index.html` + `js/game.js`) and one list page (`daily.html`) for “past puzzles.”
- **Backend**: Express server that serves the API and static files; board data comes from or is saved to SQLite via `db.js`.
- **External**: Scryfall API is used only from the browser to search for cards and get their properties (color, type, CMC, year).

---

## File-by-file

### 1. `db.js` — Database layer

- **Role**: Store and load one puzzle per calendar day.
- **Storage**: SQLite file `mtgdoku.db` in the project root. Table `puzzles`: columns `date` (YYYY-MM-DD), `row_criteria`, `col_criteria` (JSON strings), `created_at`.
- **`init()`**: Opens the DB and creates the table if it doesn’t exist. Safe to call multiple times.
- **`getPuzzle(dateStr)`**: Returns `{ rowCriteria, colCriteria }` for that date, or `null` if there is no row. Parses the JSON in the two criteria columns.
- **`savePuzzle(dateStr, rowCriteria, colCriteria)`**: Writes or overwrites the puzzle for that date (INSERT with ON CONFLICT UPDATE).
- **`todayUTC()`**: Returns today’s date in YYYY-MM-DD using UTC (used by the server when no date is provided).

So: **one row per day**, criteria stored as JSON; the rest of the app uses the parsed arrays.

---

### 2. `server.js` — Backend

- **Role**: Run the HTTP server, generate or load puzzles, serve static files and the daily list page.

**Criteria pools (data)**  
Four arrays define what can appear on the board:

- **allColors**: White, Blue, Black, Red, Green (codes like `c:w`, `c:u`, …).
- **allTypes**: Creature, Instant, Sorcery, Enchantment, Artifact (`type:creature`, …).
- **allCMCs**: Mana value ranges (`mv<=2`, `mv=3`, `mv=4`, `mv>=5`).
- **allYears**: Release year ranges (pre-2000, 2000–2009, 2010–2019, 2020+).

**Board generation helpers**

- **`shuffleArray(array)`**: Fisher–Yates shuffle so we pick random criteria.
- **`areCriteriaCompatible(critA, critB)`**: Decides if one card could satisfy both criteria. Prevents impossible cells, e.g. “Mana Value 3” row × “Mana Value 4” column. Rules: same CMC or same year range → incompatible; same color or different categories → compatible; for types, Instant/Sorcery are exclusive with each other and with others.
- **`generateBoard()`**: Shuffles all criteria, picks 3 rows, then finds 3 columns that are compatible with every row (so every cell is solvable). Returns `{ rowCriteria, colCriteria }`. If it can’t find a perfect set in 10 tries, it falls back to the first 6 criteria (some cells might be hard or impossible).
- **`isValidBoard(board)`**: Ensures we have exactly 3 row and 3 column criteria, each with `name` and `code`. Used to reject bad or test data and trigger regeneration.

**Routes**

- **`GET /api/board`**: Optional query `?date=YYYY-MM-DD`. If missing, uses `db.todayUTC()`. Loads that date’s puzzle from the DB; if missing or invalid (e.g. old test data), calls `generateBoard()`, saves it, then returns `{ rowCriteria, colCriteria, date }`.
- **`GET /daily`**: Sends the past-puzzles list page (`daily.html`).
- **Static**: Serves files from the project root (e.g. `index.html`, `css/`, `js/`).
- **Catch-all**: Any other non-API path serves `index.html` (so the game works on refresh or direct URLs).

**Startup**  
Before listening, the server ensures today’s (UTC) puzzle exists and is valid; if not, it generates and saves it. That way the main page and “Today” on `/daily` always have a valid board.

---

### 3. `js/game.js` — Frontend game logic

- **Role**: Load the board, draw the grid, handle search and guesses, and decide win/lose.

**Search helper**

- **`fuzzyMatch(needle, haystack)`**: Checks if the letters of `needle` appear in order in `haystack` (e.g. “boltz” in “Bolt”). Returns a score (higher = better) or -Infinity. Used to sort Scryfall results so the best name matches appear first.

**Class `MTGDokuGame`**

- **Constructor**: Creates a 9-cell grid (each cell: `selectedCard`, `guessCount`, `solved`), sets empty `rowCriteria`/`colCriteria`, guess limit 6, and calls `init()`.
- **`init()`**:  
  - Reads `?date=YYYY-MM-DD` from the URL; if missing or invalid, uses the **browser’s local today**.  
  - Fetches `GET /api/board?date=...`, then fills `rowCriteria`, `colCriteria`, and `puzzleDate`.  
  - On failure, replaces the page with an error message.  
  - Then wires up events and calls `generateNewGame()` (labels + date display).
- **`setupEventListeners()`**: New Game (reload), grid cell clicks (open search modal), modal close, search input (debounced), Play Again (reload).
- **`updateLabels()`**: Writes the three row and three column criterion names into the label elements.
- **`updatePuzzleDateDisplay()`**: Shows “Daily Puzzle · Month DD, YYYY” from `puzzleDate`.
- **`openSearchModal(cellIndex)`**: Remembers `currentCell`, shows the search modal, clears the input and results.
- **`handleSearch(event)`**: Debounces typing (300 ms) then calls `performSearch(query)`.
- **`performSearch(query)`**: Calls Scryfall `cards/search?q="query"`, then scores and sorts results with `fuzzyMatch`, shows up to 10 in the modal.
- **`displaySearchResults(cards)`**: Renders each card (image + name + type); click calls `selectCard(card)`.
- **`selectCard(card)`**: Saves a normalized card (name, imageUrl, type, colors, cmc, released_at) into `grid[currentCell].selectedCard`, increments `guessCount`, calls `submitGuess(cellIndex)`, closes the modal.
- **`submitGuess(cellIndex)`**: Computes row/col from index, gets row/column criteria, calls `validateCard(selectedCard, rowCrit, colCrit)`. If valid → `handleCorrectGuess`, else → `handleIncorrectGuess`. Then updates stats.
- **`validateCard`**: Runs `checkSingleCriteria` for row and column; returns `{ isValid, rowMatch, colMatch }`.
- **`checkSingleCriteria(card, criteria)`**: Interprets `criteria.code`:  
  - `c:X` → card must have color X.  
  - `type:X` → card’s type line must contain X.  
  - `mv...` → card’s CMC vs the number (<=, >=, =).  
  - `year...` → card’s release year vs the condition(s).  
  Returns true/false.
- **`handleCorrectGuess`**: Marks cell solved, disables it, shows card image and name and a checkmark. If 9 solved, shows win modal.
- **`handleIncorrectGuess`**: If guess count for that cell is already 6 → mark cell failed, show game-over modal. Otherwise add error styling and briefly flash/shake the row or column label that didn’t match.
- **`updateStats()`**: Updates the “Guesses” and “Solved” counters in the header.
- **`winGame()` / `loseGame()`**: Show the appropriate modal with message. Lose message explains that any card matching both criteria would have been correct.
- **`getTotalGuesses()`**: Sum of all cells’ `guessCount` (used in the win message).

On `DOMContentLoaded`, the script creates one `MTGDokuGame()` instance so the game starts when the page loads.

---

### 4. `index.html` — Main game page

- One **container** with **header** (title, subtitle, puzzle date placeholder, “Past puzzles” link), **main** (controls, stats, grid container with 3 column labels and 3 rows of 1 row label + 3 cells), **How to Play**, and two **modals**: search (input + results div) and game over (title, message, Play Again).
- Row/column labels are empty in HTML; `game.js` fills them from the API response. Same for the puzzle date.
- Script: `js/game.js`.

---

### 5. `daily.html` — Past puzzles list

- Same header style; “Past daily puzzles” and a link back to “Today’s puzzle” (`/`).
- An intro line and an empty `<ul id="puzzleDayList">`.
- Inline script: Builds **4 dates** (today, yesterday, 2 days ago, 3 days ago) in **local** time, formats each as YYYY-MM-DD and as a readable date. For each, appends a list item with a label (“Today”, “Yesterday”, …), the formatted date, and a “Play” link to `/?date=YYYY-MM-DD`. Clicking Play opens the main game with that day’s puzzle.

---

### 6. `css/styles.css` — Styling

- **Variables** in `:root`: primary/secondary/success/danger colors, backgrounds, text, border, MTG color accents, transition.
- **Layout**: Container, header, main content, grid (labels + cells), controls, stats.
- **Grid cells**: Default, hover, solved (green tint), error (red tint), and card image/name when solved.
- **Modals**: Overlay, content box, search input, search results list.
- **Past puzzles page**: Nav link, list intro, day rows (label, date, Play button).
- **Responsive**: Breakpoints for smaller screens (narrower grid, stacked controls).
- **Animations**: Flash and shake for wrong-guess feedback on labels.

---

## Data flow summary

1. **Page load (main game)**  
   User opens `/` or `/?date=2026-02-18`.  
   → `game.js` reads `date` from URL or uses local today.  
   → Fetches `/api/board?date=...`.  
   → Server gets/creates that date’s puzzle (from DB or `generateBoard()` + save).  
   → Response: `{ rowCriteria, colCriteria, date }`.  
   → Frontend fills labels and puzzle date, and is ready for play.

2. **Playing a cell**  
   User clicks a cell → search modal opens.  
   → User types → after 300 ms, Scryfall is queried → results shown and sorted by `fuzzyMatch`.  
   → User clicks a card → `selectCard` stores it and calls `submitGuess`.  
   → Frontend checks the card against the cell’s row and column criteria (`checkSingleCriteria`).  
   → Correct: cell marked solved, maybe win. Wrong: feedback and maybe game over after 6 guesses on that cell.

3. **Past puzzles**  
   User opens `/daily`.  
   → `daily.html` builds 4 days and links to `/?date=YYYY-MM-DD`.  
   → Clicking “Play” loads the game with that date; the same `/api/board?date=...` flow runs, so that day’s puzzle is loaded or created and shown.

All of this is commented in the code so you can jump to any file and follow the same structure as in this document.
