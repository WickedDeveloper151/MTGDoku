/**
 * MTGDoku Frontend — Magic: The Gathering 3x3 guessing game.
 *
 * Flow: fetch board (row/column criteria) from GET /api/board, then for each
 * cell the player searches Scryfall and picks a card. A guess is correct if the
 * card matches both the row and column criteria for that cell ("any valid card").
 */

// =====================
// Search helpers
// =====================

/**
 * Fuzzy match: checks if the letters in `needle` (search input) appear in order
 * in `haystack` (card name). Returns a score (higher = better match), or
 * -Infinity if not a match. Used to rank Scryfall results.
 */
function fuzzyMatch(needle, haystack) {
    const haystackLower = haystack.toLowerCase();
    const needleLower = needle.toLowerCase();
    let score = 0;
    let needleIdx = 0;

    for (let haystackIdx = 0; haystackIdx < haystackLower.length; haystackIdx++) {
        if (needleLower[needleIdx] === haystackLower[haystackIdx]) {
            score += 1;
            needleIdx++;
        } else if (needleIdx > 0) {
            score -= 0.5; // Penalty for gaps between matching letters
        }

        if (needleIdx === needleLower.length) {
            return score + (10 / (haystackIdx + 1)); // Prefer matches that finish earlier
        }
    }

    return needleIdx === needleLower.length ? score : -Infinity;
}

// =====================
// Game controller
// =====================

/**
 * Main game state and UI. Fetches board from backend, handles cell clicks,
 * card search (Scryfall), validation (row + column criteria), and win/lose.
 */
class MTGDokuGame {
    constructor() {
        // Grid: 9 cells (3 rows × 3 cols). Each has selectedCard, guessCount, solved.
        this.grid = Array(9).fill(null).map(() => ({
            targetCard: null,
            selectedCard: null,
            guessCount: 0,
            solved: false
        }));

        // Filled by init() from GET /api/board (daily puzzle)
        this.rowCriteria = [];
        this.colCriteria = [];
        this.puzzleDate = null; // YYYY-MM-DD from API, for display

        this.guessLimit = 6;   // Max guesses per cell before game over
        this.totalSolved = 0;
        this.gameOver = false;
        this.currentCell = null;  // Index of cell whose search modal is open
        this.searchTimeout = null; // For debouncing search input

        this.init();
    }

    /**
     * Load board from backend, then bind events and render labels.
     * If fetch fails (e.g. no server), show a short error message.
     *
     * On GitHub Pages, the static frontend is hosted at user.github.io/<repo>,
     * but the Node/SQLite backend must be hosted elsewhere (e.g. Render/Railway).
     * BACKEND_BASE switches between local origin (dev) and a configurable
     * production URL when running under *.github.io.
     */
    async init() {
        try {
            const isGitHubPages = window.location.hostname.endsWith('github.io');
            const BACKEND_BASE = isGitHubPages
                ? 'https://YOUR-BACKEND-HOST-HERE'   // TODO: replace with your deployed backend URL
                : window.location.origin;
            const params = new URLSearchParams(window.location.search);
            let dateParam = params.get('date');
            if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
                const t = new Date();
                const y = t.getFullYear(), m = String(t.getMonth() + 1).padStart(2, '0'), d = String(t.getDate()).padStart(2, '0');
                dateParam = y + '-' + m + '-' + d;
            }
            const response = await fetch(`${BACKEND_BASE}/api/board?date=${encodeURIComponent(dateParam)}`);
            if (!response.ok) throw new Error('Failed to load board');
            const data = await response.json();
            this.rowCriteria = data.rowCriteria;
            this.colCriteria = data.colCriteria;
            this.puzzleDate = data.date || null;
        } catch (err) {
            console.error('Board fetch error:', err);
            document.body.innerHTML = '<div class="container" style="padding: 40px; text-align: center;"><h1>MTGDoku</h1><p>Could not load game. Is the server running? Run <code>npm start</code> and open <a href="/">http://localhost:3000</a>.</p></div>';
            return;
        }

        this.setupEventListeners();
        await this.generateNewGame();
    }

    /** Attach click handlers: New Game, each grid cell, search modal close/search input, Play Again. */
    setupEventListeners() {
        // New game button
        document.getElementById('newGameBtn').addEventListener('click', () => {
            if (confirm('Start a new game?')) {
                location.reload();
            }
        });

        // When a grid cell is clicked, open the search modal
        document.querySelectorAll('.grid-cell').forEach((btn, index) => {
            btn.addEventListener('click', () => this.openSearchModal(index));
        });

        // Search modal
        const searchModal = document.getElementById('searchModal');
        const searchInput = document.getElementById('cardSearchInput');
        const closeBtn = searchModal.querySelector('.close');

        closeBtn.addEventListener('click', () => {
            searchModal.classList.add('hidden');
        });

        // Listen for typing in the search box
        searchInput.addEventListener('input', (e) => this.handleSearch(e));

        // Close modal when clicking outside
        searchModal.addEventListener('click', (e) => {
            if (e.target === searchModal) {
                searchModal.classList.add('hidden');
            }
        });

        // Play again (reloads page and fetches a new board)
        document.getElementById('playAgainBtn').addEventListener('click', () => {
            location.reload();
        });
    }

    /** Apply current row/column criteria and puzzle date to the UI. */
    async generateNewGame() {
        this.updateLabels();
        this.updatePuzzleDateDisplay();
    }

    /** Show "Daily Puzzle · Month DD, YYYY" in the header (from this.puzzleDate). */
    updatePuzzleDateDisplay() {
        const el = document.getElementById('puzzleDate');
        if (!el || !this.puzzleDate) {
            if (el) el.textContent = '';
            return;
        }
        const [y, m, d] = this.puzzleDate.split('-');
        const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
        const formatted = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        el.textContent = `Daily Puzzle · ${formatted}`;
    }

    /** Write row and column criterion names into the grid label elements. */
    updateLabels() {
        for (let i = 0; i < 3; i++) {
            document.getElementById(`colLabel${i + 1}`).textContent = this.colCriteria[i].name;
        }
        for (let i = 0; i < 3; i++) {
            document.getElementById(`rowLabel${i + 1}`).textContent = this.rowCriteria[i].name;
        }
    }

    /** Open the card-search modal for the given cell (if not already solved). */
    openSearchModal(cellIndex) {
        const cell = this.grid[cellIndex];

        // If the cell is already solved, don't let them change it
        if (cell.solved) {
            return;
        }

        this.currentCell = cellIndex;
        const modal = document.getElementById('searchModal');
        const searchInput = document.getElementById('cardSearchInput');

        modal.classList.remove('hidden');
        searchInput.value = '';
        searchInput.focus();
        document.getElementById('searchResults').innerHTML = '';
    }

    /**
     * Debounced search: wait 300ms after last keystroke before calling Scryfall,
     * to avoid spamming the API while the user is still typing.
     */
    async handleSearch(event) {
        const query = event.target.value.trim();

        if (query.length < 1) {
            document.getElementById('searchResults').innerHTML = '';
            return;
        }

        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => this.performSearch(query), 300);
    }

    /** Call Scryfall search API and show up to 10 results, sorted by fuzzy match score. */
    async performSearch(query) {
        try {
            // Ask Scryfall for cards with this name
            const response = await fetch(`https://api.scryfall.com/cards/search?q="${query}" unique:cards&order=released`);

            if (!response.ok) {
                if (response.status === 404) {
                    document.getElementById('searchResults').innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-light);">No cards found</div>';
                } else {
                    throw new Error('API error');
                }
                return;
            }

            const data = await response.json();
            const cards = data.data || [];

            // Sort the results so the best matches appear first
            const scored = cards.map(card => ({
                card,
                score: fuzzyMatch(query, card.name)
            }))
                .filter(item => item.score > -Infinity)
                .sort((a, b) => b.score - a.score)
                .slice(0, 10)
                .map(item => item.card);

            this.displaySearchResults(scored);
        } catch (error) {
            console.error('Error searching cards:', error);
            document.getElementById('searchResults').innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-light);">Error fetching cards</div>';
        }
    }

    /** Render the list of cards in the search modal; clicking one calls selectCard(card). */
    displaySearchResults(cards) {
        const resultsContainer = document.getElementById('searchResults');
        resultsContainer.innerHTML = '';

        if (cards.length === 0) {
            resultsContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-light);">No results</div>';
            return;
        }

        cards.forEach(card => {
            const resultItem = document.createElement('div');
            resultItem.className = 'search-result-item';

            const img = document.createElement('img');
            img.src = card.image_uris?.small || 'https://via.placeholder.com/50x75';
            img.alt = card.name;
            img.className = 'search-result-image';

            const info = document.createElement('div');
            info.className = 'search-result-info';

            const name = document.createElement('div');
            name.className = 'search-result-name';
            name.textContent = card.name;

            const type = document.createElement('div');
            type.className = 'search-result-type';
            type.textContent = card.type_line;

            info.appendChild(name);
            info.appendChild(type);

            resultItem.appendChild(img);
            resultItem.appendChild(info);

            // When a card is clicked, select it
            resultItem.addEventListener('click', () => {
                this.selectCard(card);
            });

            resultsContainer.appendChild(resultItem);
        });
    }

    /**
     * User picked a card from search results. Store it on the cell, increment
     * guess count, validate against row/column criteria, then close modal.
     */
    selectCard(card) {
        const cellIndex = this.currentCell;
        const cell = this.grid[cellIndex];

        if (cell.solved) return;

        // Normalize to the shape checkSingleCriteria expects (colors, type, cmc, released_at)
        cell.selectedCard = {
            name: card.name,
            imageUrl: card.image_uris?.normal || card.image_uris?.small || null,
            type: card.type_line,
            manaCost: card.mana_cost || 'N/A',
            colors: card.colors || [],
            cmc: card.cmc,
            released_at: card.released_at,
            id: card.id
        };

        cell.guessCount++;
        this.submitGuess(cellIndex);

        // Close modal
        document.getElementById('searchModal').classList.add('hidden');
    }

    /**
     * Validate the current cell's selectedCard against this cell's row and column
     * criteria. If valid → mark cell solved and maybe win; if invalid → wrong-guess
     * feedback or game over if guess limit reached.
     */
    submitGuess(cellIndex) {
        const cell = this.grid[cellIndex];
        const rowIndex = Math.floor(cellIndex / 3);
        const colIndex = cellIndex % 3;
        const rowCrit = this.rowCriteria[rowIndex];
        const colCrit = this.colCriteria[colIndex];

        const validation = this.validateCard(cell.selectedCard, rowCrit, colCrit);

        if (validation.isValid) {
            this.handleCorrectGuess(cellIndex, cell);
        } else {
            this.handleIncorrectGuess(cellIndex, cell, rowIndex, colIndex, validation);
        }

        this.updateStats();
    }

    /** Returns { isValid, rowMatch, colMatch } for the card vs row/column criteria. */
    validateCard(card, rowCrit, colCrit) {
        const rowMatch = this.checkSingleCriteria(card, rowCrit);
        const colMatch = this.checkSingleCriteria(card, colCrit);

        return { isValid: rowMatch && colMatch, rowMatch, colMatch };
    }

    /**
     * Returns true if the card satisfies one criterion. Interprets criterion.code:
     * c:X (color), type:X (type line), mv... (CMC), year... (released_at year).
     */
    checkSingleCriteria(card, criteria) {
        if (!criteria || !criteria.code) return true;
        const code = criteria.code;

        // Color: card must be at least this color (e.g. c:u = blue)
        if (code.startsWith('c:')) {
            const color = code.split(':')[1].toUpperCase();
            const cardColors = (card.colors || []).map(c => c.toUpperCase());
            return cardColors.includes(color);
        }

        // Type: card's type_line must contain this (e.g. type:creature)
        if (code.startsWith('type:')) {
            const type = code.split(':')[1].toLowerCase();
            return card.type.toLowerCase().includes(type);
        }

        // Mana value: compare card.cmc to the number in the code (<=, >=, =, etc.)
        if (code.startsWith('mv')) {
            const val = parseInt(code.match(/\d+/)[0]);
            const cardMVC = card.cmc !== undefined ? card.cmc : 0;
            if (code.includes('<=')) return cardMVC <= val;
            if (code.includes('>=')) return cardMVC >= val;
            if (code.includes('<')) return cardMVC < val;
            if (code.includes('>')) return cardMVC > val;
            return cardMVC === val;
        }

        // Release year: card.released_at is "YYYY-MM-DD"; code can be "year<2000" or "year>=2010 year<=2019"
        if (code.startsWith('year')) {
            const cardYear = card.released_at ? parseInt(card.released_at.split('-')[0]) : 0;
            const parts = code.split(' ');
            return parts.every(part => {
                const val = parseInt(part.match(/\d+/)[0]);
                if (part.includes('<=')) return cardYear <= val;
                if (part.includes('>=')) return cardYear >= val;
                if (part.includes('<')) return cardYear < val;
                if (part.includes('>')) return cardYear > val;
                return cardYear === val;
            });
        }

        return true;
    }

    /** Mark cell as solved, show card image and name, disable cell. If 9/9 solved, win. */
    handleCorrectGuess(cellIndex, cell) {
        if (!cell.solved) {
            cell.solved = true;
            this.totalSolved++;
        }

        const gridCellBtn = document.querySelectorAll('.grid-cell')[cellIndex];
        gridCellBtn.classList.add('solved');
        gridCellBtn.disabled = true;

        gridCellBtn.innerHTML = `
            <img src="${cell.selectedCard.imageUrl}" alt="${cell.selectedCard.name}" class="grid-cell-image">
            <div class="grid-cell-name">${cell.selectedCard.name}</div>
            <div class="grid-cell-status">✓</div>
        `;

        if (this.totalSolved === 9) this.winGame();
    }

    /**
     * Wrong guess: if guess limit reached for this cell → disable cell and trigger
     * game over; otherwise show brief error state and flash/shake the row/column
     * label that didn't match.
     */
    handleIncorrectGuess(cellIndex, cell, rowIndex, colIndex, validation) {
        const gridCellBtn = document.querySelectorAll('.grid-cell')[cellIndex];

        if (cell.guessCount >= this.guessLimit) {
            gridCellBtn.classList.add('error');
            gridCellBtn.disabled = true;
            
            const status = document.createElement('div');
            status.className = 'grid-cell-status';
            status.textContent = '✗';
            gridCellBtn.appendChild(status);

            this.gameOver = true;
            this.loseGame();
        } else {
            gridCellBtn.classList.add('error');

            const rowEl = document.getElementById(`rowLabel${rowIndex + 1}`);
            const colEl = document.getElementById(`colLabel${colIndex + 1}`);

            if (!validation.rowMatch && rowEl) {
                rowEl.classList.add('flash');
                setTimeout(() => rowEl.classList.remove('flash'), 700);
            }

            if (!validation.colMatch && colEl) {
                colEl.classList.add('shake');
                setTimeout(() => colEl.classList.remove('shake'), 600);
            }

            setTimeout(() => gridCellBtn.classList.remove('error'), 700);
        }
    }

    /** Refresh the stats display: total guesses and number of solved cells. */
    updateStats() {
        let totalGuesses = 0;
        for (let cell of this.grid) {
            if (cell.guessCount > 0) {
                totalGuesses += cell.guessCount;
            }
        }

        document.getElementById('guessCount').textContent = totalGuesses;
        document.getElementById('solvedCount').textContent = this.totalSolved;
    }

    /** Show win modal with total guesses. */
    winGame() {
        setTimeout(() => {
            const modal = document.getElementById('gameOverModal');
            document.getElementById('gameOverTitle').textContent = '🎉 You Won!';
            document.getElementById('gameOverMessage').textContent =
                `Congratulations! You solved all 9 cards with ${this.getTotalGuesses()} total guesses.`;

            modal.classList.remove('hidden');
        }, 500);
    }

    /** Show game over modal (any-valid-card message: no "correct" card list). */
    loseGame() {
        setTimeout(() => {
            const modal = document.getElementById('gameOverModal');
            document.getElementById('gameOverTitle').textContent = '😢 Game Over';
            document.getElementById('gameOverMessage').textContent =
                'You ran out of guesses on a cell. Any card that matched both the row and column criteria would have been correct—try again!';

            modal.classList.remove('hidden');
        }, 500);
    }

    /** Sum of guessCount across all cells (for win message). */
    getTotalGuesses() {
        return this.grid.reduce((total, cell) => total + cell.guessCount, 0);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new MTGDokuGame();
});
