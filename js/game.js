// Utility: fuzzyMatch
// Scores how well `needle` matches characters in `haystack` in order.
// Returns a numeric score (higher = better) or -Infinity when not all
// characters are found in sequence. Used to rank search results.
function fuzzyMatch(needle, haystack) {
    const hLower = haystack.toLowerCase();
    const nLower = needle.toLowerCase();
    let score = 0;
    let nIdx = 0;

    for (let hIdx = 0; hIdx < hLower.length; hIdx++) {
        if (nLower[nIdx] === hLower[hIdx]) {
            score += 1;
            nIdx++;
        } else if (nIdx > 0) {
            score -= 0.5;
        }

        if (nIdx === nLower.length) {
            return score + (10 / (hIdx + 1));
        }
    }

    return nIdx === nLower.length ? score : -Infinity;
}

// Main game controller class
// encapsulates game state, setup, UI wiring, and gameplay logic.
class MTGDokuGame {
    constructor() {
        this.grid = Array(9).fill(null).map(() => ({
            targetCard: null,
            selectedCard: null,
            guessCount: 0,
            solved: false
        }));

        // All possible colors and types
        this.allColors = [
            { name: 'White Cards', code: 'c:w' },
            { name: 'Blue Cards', code: 'c:u' },
            { name: 'Black Cards', code: 'c:b' },
            { name: 'Red Cards', code: 'c:r' },
            { name: 'Green Cards', code: 'c:g' }
        ];

        this.allTypes = [
            { name: 'Creatures', code: 'type:creature' },
            { name: 'Instants', code: 'type:instant' },
            { name: 'Sorceries', code: 'type:sorcery' },
            { name: 'Enchantments', code: 'type:enchantment' },
            { name: 'Artifacts', code: 'type:artifact' }
        ];

        // Randomized for this game
        this.rowCriteria = [];
        this.colCriteria = [];

        this.guessLimit = 6;
        this.totalSolved = 0;
        this.gameOver = false;
        this.currentCell = null;
        this.searchTimeout = null;

        this.init();
    }

    // Helper: shuffleArray
    // Returns a shuffled copy of the provided array using Fisher-Yates.
    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    // Initialize the game: pick randomized criteria, wire events, create board
    async init() {
        // Randomize rows and columns
        const shuffledColors = this.shuffleArray(this.allColors);
        const shuffledTypes = this.shuffleArray(this.allTypes);

        // Take the first 3 of each
        this.rowCriteria = shuffledColors.slice(0, 3);
        this.colCriteria = shuffledTypes.slice(0, 3);

        this.setupEventListeners();
        await this.generateNewGame();
    }

    // Wire DOM event listeners for controls, grid cells and modals
    setupEventListeners() {
        // New game button
        document.getElementById('newGameBtn').addEventListener('click', () => {
            if (confirm('Start a new game?')) {
                location.reload();
            }
        });

        // Hint button
        document.getElementById('hintBtn').addEventListener('click', () => this.giveHint());

        // Grid cell buttons
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

        searchInput.addEventListener('input', (e) => this.handleSearch(e));

        // Close modal when clicking outside
        searchModal.addEventListener('click', (e) => {
            if (e.target === searchModal) {
                searchModal.classList.add('hidden');
            }
        });

        // Play again button
        document.getElementById('playAgainBtn').addEventListener('click', () => {
            location.reload();
        });
    }

    // Board generation: fetch and store a target card for each cell
    async generateNewGame() {
        // No longer picking a random correct answer for each cell
        // If needed, initialize grid or labels here
        this.updateLabels();
    }

    // Data fetch: query Scryfall and return a random card matching criteria
    async getRandomCardForCriteria(rowCriteria, colCriteria) {
        let query = this.buildScryfallQuery(rowCriteria, colCriteria);

        try {
            // Use a random page to get different cards each time
            const randomPage = Math.floor(Math.random() * 5) + 1; // Pages 1-5
            const response = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=cards&page=${randomPage}`);

            if (!response.ok) {
                throw new Error('Scryfall API error');
            }

            const data = await response.json();

            if (data.data && data.data.length > 0) {
                // Get a truly random card from this page's results
                const randomCard = data.data[Math.floor(Math.random() * data.data.length)];
                return {
                    name: randomCard.name,
                    imageUrl: randomCard.image_uris?.normal || randomCard.image_uris?.small || null,
                    type: randomCard.type_line,
                    manaCost: randomCard.mana_cost || 'N/A',
                    colors: randomCard.colors || [],
                    id: randomCard.id
                };
            }

            return null;
        } catch (error) {
            console.error('Error fetching card:', error);
            return null;
        }
    }

    // Query builder: create a Scryfall search string from row/column criteria
    buildScryfallQuery(rowCriteria, colCriteria) {
        return `${rowCriteria.code} ${colCriteria.code}`;
    }

    // UI: write the selected row and column labels into the DOM
    updateLabels() {
        // Update column labels
        for (let i = 0; i < 3; i++) {
            document.getElementById(`colLabel${i + 1}`).textContent = this.colCriteria[i].name;
        }

        // Update row labels
        for (let i = 0; i < 3; i++) {
            document.getElementById(`rowLabel${i + 1}`).textContent = this.rowCriteria[i].name;
        }
    }

    // UI: open the card search modal for a specific grid cell
    openSearchModal(cellIndex) {
        const cell = this.grid[cellIndex];

        // Don't allow changing solved cells
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

    // Input handler: debounce the user's search input
    async handleSearch(event) {
        const query = event.target.value.trim();

        if (query.length < 1) {
            document.getElementById('searchResults').innerHTML = '';
            return;
        }

        // Debounce the search
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => this.performSearch(query), 300);
    }

    // Fetch & rank: perform the Scryfall search and sort results by fuzzy score
    async performSearch(query) {
        try {
            // Fetch cards from Scryfall API
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

            // Sort by fuzzy match score
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

    // Render search results in the modal
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

            resultItem.addEventListener('click', () => {
                this.selectCard(card);
            });

            resultsContainer.appendChild(resultItem);
        });
    }

    // Handle selection of a search result: store chosen card and submit guess
    selectCard(card) {
        const cellIndex = this.currentCell;
        const cell = this.grid[cellIndex];

        if (cell.solved) {
            return;
        }

        cell.selectedCard = {
            name: card.name,
            imageUrl: card.image_uris?.normal || card.image_uris?.small || null,
            type: card.type_line,
            manaCost: card.mana_cost || 'N/A',
            colors: card.colors || [],
            id: card.id
        };

        cell.guessCount++;
        this.submitGuess(cellIndex);

        // Close modal
        document.getElementById('searchModal').classList.add('hidden');
    }

    // Validate a guess for a specific cell against that cell's criteria
    // Marks the cell solved on success, otherwise applies error feedback
    submitGuess(cellIndex) {
        const cell = this.grid[cellIndex];
        const gridCellBtn = document.querySelectorAll('.grid-cell')[cellIndex];
        // Validate the selected card against the cell's row (color) and column (type)
        const rowIndex = Math.floor(cellIndex / 3);
        const colIndex = cellIndex % 3;
        const rowCrit = this.rowCriteria[rowIndex];
        const colCrit = this.colCriteria[colIndex];

        const cardColors = (cell.selectedCard.colors || []).map(c => c.toUpperCase());
        const colorCode = (rowCrit && rowCrit.code) ? rowCrit.code.split(':')[1].toUpperCase() : null; // e.g. 'W'
        const typeKeyword = (colCrit && colCrit.code) ? colCrit.code.split(':')[1].toLowerCase() : null; // e.g. 'creature'

        const colorMatch = colorCode ? cardColors.includes(colorCode) : true;
        const typeMatch = typeKeyword ? (cell.selectedCard.type.toLowerCase().includes(typeKeyword)) : true;

        if (colorMatch && typeMatch) {
            // Mark correct
            if (!cell.solved) {
                cell.solved = true;
                this.totalSolved++;
            }

            gridCellBtn.classList.add('solved');
            gridCellBtn.disabled = true;

            const img = document.createElement('img');
            img.src = cell.selectedCard.imageUrl;
            img.alt = cell.selectedCard.name;
            img.className = 'grid-cell-image';

            const name = document.createElement('div');
            name.className = 'grid-cell-name';
            name.textContent = cell.selectedCard.name;

            const status = document.createElement('div');
            status.className = 'grid-cell-status';
            status.textContent = '✓';

            gridCellBtn.innerHTML = '';
            gridCellBtn.appendChild(img);
            gridCellBtn.appendChild(name);
            gridCellBtn.appendChild(status);

            if (this.totalSolved === 9) this.winGame();
        } else {
            // Incorrect guess
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

                // Visual feedback on which criteria failed
                const rowEl = document.getElementById(`rowLabel${rowIndex + 1}`);
                const colEl = document.getElementById(`colLabel${colIndex + 1}`);

                if (!colorMatch && rowEl) {
                    rowEl.classList.add('flash');
                    setTimeout(() => rowEl.classList.remove('flash'), 700);
                }

                if (!typeMatch && colEl) {
                    colEl.classList.add('shake');
                    setTimeout(() => colEl.classList.remove('shake'), 600);
                }

                // Remove small error state from the button after animation
                setTimeout(() => gridCellBtn.classList.remove('error'), 700);
            }
        }

        this.updateStats();
    }

    // Update UI counters for total guesses and solved cells
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

    // Endgame: show win modal with summary
    winGame() {
        setTimeout(() => {
            const modal = document.getElementById('gameOverModal');
            document.getElementById('gameOverTitle').textContent = '🎉 You Won!';
            document.getElementById('gameOverMessage').textContent =
                `Congratulations! You solved all 9 cards with ${this.getTotalGuesses()} total guesses.`;

            modal.classList.remove('hidden');
        }, 500);
    }

    // Endgame: show lose modal and reveal remaining targets
    loseGame() {
        setTimeout(() => {
            const modal = document.getElementById('gameOverModal');
            document.getElementById('gameOverTitle').textContent = '😢 Game Over';
            document.getElementById('gameOverMessage').textContent =
                `You ran out of guesses on a cell. The correct cards were: ${this.getGameOverCards()}`;

            modal.classList.remove('hidden');
        }, 500);
    }

    // Helper: total guesses across all cells
    getTotalGuesses() {
        return this.grid.reduce((total, cell) => total + cell.guessCount, 0);
    }

    // Helper: list of unsolved target card names for game-over message
    getGameOverCards() {
        return this.grid.filter(c => !c.solved && c.targetCard).map(c => c.targetCard.name).join(', ');
    }

    // Hint: pick a random unsolved cell and reveal a short prefix of its name
    giveHint() {
        // Get all unsolved cells with target cards
        const unsolvedCells = [];
        for (let i = 0; i < this.grid.length; i++) {
            if (!this.grid[i].solved && this.grid[i].targetCard) {
                unsolvedCells.push(i);
            }
        }

        if (unsolvedCells.length === 0) {
            alert('All cells are solved!');
            return;
        }

        // Pick a random unsolved cell
        const randomIndex = Math.floor(Math.random() * unsolvedCells.length);
        const cellIndex = unsolvedCells[randomIndex];
        const cell = this.grid[cellIndex];

        const hint = cell.targetCard.name.substring(0, 3);
        alert(`Hint for cell ${cellIndex + 1}: Card starts with "${hint}"`);
    }
}

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', () => {
    new MTGDokuGame();
});
