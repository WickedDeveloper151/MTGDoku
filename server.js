/**
 * MTGDoku Backend Server
 *
 * Serves one daily puzzle per calendar day (UTC), stored in SQLite. The frontend
 * fetches the board from GET /api/board (optionally ?date=YYYY-MM-DD) and
 * validates guesses using Scryfall card data.
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Allow frontend on GitHub Pages (e.g. https://username.github.io) and local dev
app.use(cors({
    origin: [
        /^https:\/\/[\w-]+\.github\.io$/,  // GitHub Pages
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:5000',
        'http://127.0.0.1:5000'
    ],
    optionsSuccessStatus: 200
}));

// Initialize DB on startup (creates mtgdoku.db and puzzles table if needed)
db.init();

// =====================
// Criteria pools
// =====================
// Each criterion has a display name and a code the frontend uses to validate
// cards (e.g. "c:u" = blue color, "type:creature" = creature type).

/** MTG color identity: cards that are at least this color. */
const allColors = [
    { name: 'White Cards', code: 'c:w' },
    { name: 'Blue Cards', code: 'c:u' },
    { name: 'Black Cards', code: 'c:b' },
    { name: 'Red Cards', code: 'c:r' },
    { name: 'Green Cards', code: 'c:g' }
];

/** Card type (creature, instant, etc.). */
const allTypes = [
    { name: 'Creatures', code: 'type:creature' },
    { name: 'Instants', code: 'type:instant' },
    { name: 'Sorceries', code: 'type:sorcery' },
    { name: 'Enchantments', code: 'type:enchantment' },
    { name: 'Artifacts', code: 'type:artifact' }
];

/** Converted mana cost (CMC) ranges. */
const allCMCs = [
    { name: 'Mana Value <= 2', code: 'mv<=2' },
    { name: 'Mana Value 3', code: 'mv=3' },
    { name: 'Mana Value 4', code: 'mv=4' },
    { name: 'Mana Value >= 5', code: 'mv>=5' }
];

/** Release year ranges (from Scryfall released_at). */
const allYears = [
    { name: 'Released Pre-2000', code: 'year<2000' },
    { name: 'Released 2000-2009', code: 'year>=2000 year<=2009' },
    { name: 'Released 2010-2019', code: 'year>=2010 year<=2019' },
    { name: 'Released 2020+', code: 'year>=2020' }
];

// =====================
// Board generation helpers
// =====================

/**
 * Randomly shuffles an array in place (Fisher–Yates).
 * Used to pick random row/column criteria for each new board.
 */
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Returns true if a single card could satisfy both criteria at once.
 * Prevents impossible cells (e.g. "Mana Value 3" row vs "Mana Value 4" column).
 *
 * Rules:
 * - Different categories (color vs type, etc.) → compatible.
 * - Same color → compatible (multicolor exists).
 * - Same CMC or year range → incompatible (ranges are exclusive).
 * - Type: instant/sorcery are exclusive; creature/artifact/enchantment can overlap.
 */
function areCriteriaCompatible(critA, critB) {
    // Which category this criterion belongs to (color, type, cmc, year)
    const getCat = (c) => {
        if (c.code.startsWith('c:')) return 'color';
        if (c.code.startsWith('type:')) return 'type';
        if (c.code.startsWith('mv')) return 'cmc';
        if (c.code.startsWith('year')) return 'year';
        return 'unknown';
    };

    const catA = getCat(critA);
    const catB = getCat(critB);

    if (catA !== catB) return true;  // e.g. "Blue" + "Creatures" is fine

    if (catA === 'color') return true;   // Multicolor cards can match multiple
    if (catA === 'cmc') return false;   // A card has one CMC
    if (catA === 'year') return false;  // A card has one release year

    if (catA === 'type') {
        // Instant/Sorcery can't also be Creature etc.; other types can overlap (e.g. Artifact Creature)
        const isExclusive = (code) => code.includes('instant') || code.includes('sorcery');
        if (isExclusive(critA.code) || isExclusive(critB.code)) return false;
        return true;
    }

    return true;
}

/**
 * Builds one puzzle board: 3 row criteria and 3 column criteria such that
 * every row/column pair is compatible (so each cell has at least one valid card).
 * Returns { rowCriteria, colCriteria } for the frontend.
 */
function generateBoard() {
    const allCriteria = [
        ...allColors,
        ...allTypes,
        ...allCMCs,
        ...allYears
    ];

    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
        attempts++;
        const shuffled = shuffleArray(allCriteria);
        const rows = shuffled.slice(0, 3);
        const cols = [];

        // Find 3 column criteria that are compatible with every row (so each cell is solvable).
        for (let i = 3; i < shuffled.length; i++) {
            const candidate = shuffled[i];
            let compatible = true;
            for (const row of rows) {
                if (!areCriteriaCompatible(candidate, row)) {
                    compatible = false;
                    break;
                }
            }
            if (compatible) cols.push(candidate);
            if (cols.length === 3) break;
        }

        if (cols.length === 3) {
            return { rowCriteria: rows, colCriteria: cols };
        }
    }

    // Fallback if we couldn't find a conflict-free board: use first 6 criteria.
    // Some cells may be impossible; frontend still accepts any valid card per cell.
    const shuffled = shuffleArray(allCriteria);
    return {
        rowCriteria: shuffled.slice(0, 3),
        colCriteria: shuffled.slice(3, 6)
    };
}

// =====================
// HTTP routes
// =====================

/** True if the puzzle has exactly 3 row and 3 col criteria with name/code (rejects test or corrupt rows). */
function isValidBoard(board) {
    return board &&
        Array.isArray(board.rowCriteria) && board.rowCriteria.length === 3 &&
        Array.isArray(board.colCriteria) && board.colCriteria.length === 3 &&
        board.rowCriteria.every(c => c && typeof c.name === 'string' && typeof c.code === 'string') &&
        board.colCriteria.every(c => c && typeof c.name === 'string' && typeof c.code === 'string');
}

/**
 * GET /api/board — returns the puzzle for the given date (or today in UTC).
 * Query: ?date=YYYY-MM-DD (optional). Same date always returns the same puzzle.
 * Invalid or missing stored puzzles are regenerated and overwritten.
 * Response: { rowCriteria, colCriteria, date }.
 */
app.get('/api/board', (req, res) => {
    try {
        const dateStr = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date))
            ? req.query.date
            : db.todayUTC();

        let board = db.getPuzzle(dateStr);
        if (!isValidBoard(board)) {
            board = generateBoard();
            db.savePuzzle(dateStr, board.rowCriteria, board.colCriteria);
        }

        res.json({
            rowCriteria: board.rowCriteria,
            colCriteria: board.colCriteria,
            date: dateStr
        });
    } catch (err) {
        console.error('Board error:', err);
        res.status(500).json({ error: 'Failed to load board' });
    }
});

/** GET /daily — serves the past-puzzles list page (today + previous 3 days). */
app.get('/daily', (req, res) => {
    res.sendFile(path.join(__dirname, 'daily.html'));
});

/** Serve static assets (index.html, css/, js/) from the project root. */
app.use(express.static(path.join(__dirname)));

/** Catch-all: serve index.html for any non-API route (e.g. deep links or refresh). */
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Ensure today's puzzle exists and is valid on startup (fixes test/corrupt data)
const todayStr = db.todayUTC();
const existing = db.getPuzzle(todayStr);
if (!existing || !isValidBoard(existing)) {
    const board = generateBoard();
    db.savePuzzle(todayStr, board.rowCriteria, board.colCriteria);
    console.log('Seeded puzzle for', todayStr);
}

app.listen(PORT, () => {
    console.log(`MTGDoku server running at http://localhost:${PORT}`);
});
