// Utility: fuzzyMatch
// This function helps find cards even if you don't type the name perfectly.
// It checks if the letters in 'needle' (what you typed) appear in 'haystack' (the card name).
// It returns a score: higher is a better match.
function fuzzyMatch(needle, haystack) {
    const haystackLower = haystack.toLowerCase();
    const needleLower = needle.toLowerCase();
    let score = 0;
    let needleIdx = 0;

    // Loop through the card name to find matches
    for (let haystackIdx = 0; haystackIdx < haystackLower.length; haystackIdx++) {
        if (needleLower[needleIdx] === haystackLower[haystackIdx]) {
            // Found a matching letter!
            score += 1;
            needleIdx++;
        } else if (needleIdx > 0) {
            // Penalty for gaps between matching letters
            score -= 0.5;
        }

        // If we found all letters in the search term
        if (needleIdx === needleLower.length) {
            return score + (10 / (haystackIdx + 1));
        }
    }

    return needleIdx === needleLower.length ? score : -Infinity;
}

// Main game controller class
// This class handles the entire game: setting up the board, checking answers, and updating the screen.
class MTGDokuGame {
    constructor() {
        // Create a 9-cell grid (3x3). Each cell tracks its own state (solved, guesses, etc.)
        this.grid = Array(9).fill(null).map(() => ({
            targetCard: null,
            selectedCard: null,
            guessCount: 0,
            solved: false
        }));

        // Define all the possible rules (criteria) for rows and columns.
        // 1. Colors
        this.allColors = [
            { name: 'White Cards', code: 'c:w' },
            { name: 'Blue Cards', code: 'c:u' },
            { name: 'Black Cards', code: 'c:b' },
            { name: 'Red Cards', code: 'c:r' },
            { name: 'Green Cards', code: 'c:g' }
        ];

        // 2. Card Types
        this.allTypes = [
            { name: 'Creatures', code: 'type:creature' },
            { name: 'Instants', code: 'type:instant' },
            { name: 'Sorceries', code: 'type:sorcery' },
            { name: 'Enchantments', code: 'type:enchantment' },
            { name: 'Artifacts', code: 'type:artifact' }
        ];

        // 3. Mana Value (Cost)
        this.allCMCs = [
            { name: 'Mana Value <= 2', code: 'mv<=2' },
            { name: 'Mana Value 3', code: 'mv=3' },
            { name: 'Mana Value 4', code: 'mv=4' },
            { name: 'Mana Value >= 5', code: 'mv>=5' }
        ];

        // 4. Release Year
        this.allYears = [
            { name: 'Released Pre-2000', code: 'year<2000' },
            { name: 'Released 2000-2009', code: 'year>=2000 year<=2009' },
            { name: 'Released 2010-2019', code: 'year>=2010 year<=2019' },
            { name: 'Released 2020+', code: 'year>=2020' }
        ];

        // These will hold the specific rules chosen for the current game
        this.rowCriteria = [];
        this.colCriteria = [];

        this.guessLimit = 6;
        this.totalSolved = 0;
        this.gameOver = false;
        this.currentCell = null;
        this.searchTimeout = null;

        // Start the game setup
        this.init();
    }

    // Helper: shuffleArray
    // Mixes up a list of items randomly.
    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    // Initialize the game: pick random rules for rows/cols and set up the screen
    async init() {
        // Combine all categories into one pool
        const allCriteria = [
            ...this.allColors,
            ...this.allTypes,
            ...this.allCMCs,
            ...this.allYears
        ];

        let attempts = 0;
        let success = false;

        // Try to create a valid board where rows and columns don't conflict.
        // For example, we can't have "Mana Cost 3" intersecting with "Mana Cost 4".
        while (!success && attempts < 10) {
            attempts++;
            const shuffled = this.shuffleArray(allCriteria);
            
            // Pick the first 3 items for our rows
            const rows = shuffled.slice(0, 3);
            const cols = [];

            // Look through the rest of the items to find 3 columns that work with our rows
            for (let i = 3; i < shuffled.length; i++) {
                const candidate = shuffled[i];
                let compatible = true;
                
                // Check if this potential column works with EVERY row we picked
                for (const row of rows) {
                    if (!this.areCriteriaCompatible(candidate, row)) {
                        compatible = false;
                        break;
                    }
                }

                if (compatible) {
                    cols.push(candidate);
                }

                // If we found 3 good columns, we are done!
                if (cols.length === 3) break;
            }

            if (cols.length === 3) {
                this.rowCriteria = rows;
                this.colCriteria = cols;
                success = true;
            }
        }

        // If we couldn't find a perfect match after 10 tries, just pick random ones (fallback)
        if (!success) {
            console.warn("Could not generate conflict-free board, using random fallback.");
            const shuffled = this.shuffleArray(allCriteria);
            this.rowCriteria = shuffled.slice(0, 3);
            this.colCriteria = shuffled.slice(3, 6);
        }

        this.setupEventListeners();
        await this.generateNewGame();
    }

    // Helper: Checks if two rules can exist on the same card.
    // Returns true if they are compatible, false if they are impossible together.
    areCriteriaCompatible(critA, critB) {
        // Figure out what category each rule belongs to (color, type, etc.)
        const getCat = (c) => {
            if (c.code.startsWith('c:')) return 'color';
            if (c.code.startsWith('type:')) return 'type';
            if (c.code.startsWith('mv')) return 'cmc';
            if (c.code.startsWith('year')) return 'year';
            return 'unknown';
        };

        const catA = getCat(critA);
        const catB = getCat(critB);

        // If categories are different (e.g. Color vs Type), they are usually compatible.
        if (catA !== catB) return true;

        // If categories are the same, we need to check specific logic:
        if (catA === 'color') return true; // Multicolor cards exist
        if (catA === 'cmc') return false; // CMC ranges are exclusive
        if (catA === 'year') return false; // Year ranges are exclusive
        
        if (catA === 'type') {
            // Instants and Sorceries can't be other types (usually)
            const isExclusive = (code) => code.includes('instant') || code.includes('sorcery');
            if (isExclusive(critA.code) || isExclusive(critB.code)) return false;
            
            // But Creatures, Artifacts, and Enchantments can overlap (e.g. Artifact Creature)
            return true;
        }

        return true;
    }

    // Sets up clicks and interactions for buttons and the grid
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

        // Play again button
        document.getElementById('playAgainBtn').addEventListener('click', () => {
            location.reload();
        });
    }

    // Prepares the board for a new game
    async generateNewGame() {
        this.updateLabels();
    }

    // Updates the text on the screen to show the current rules (rows/cols)
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

    // Opens the popup window to search for a card
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

    // Handles typing in the search box.
    // Uses a "debounce" to wait until you stop typing for 300ms before searching.
    async handleSearch(event) {
        const query = event.target.value.trim();

        if (query.length < 1) {
            document.getElementById('searchResults').innerHTML = '';
            return;
        }

        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => this.performSearch(query), 300);
    }

    // Calls the Scryfall API to find cards matching the name
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

    // Shows the list of found cards in the popup
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

    // Called when the user clicks a card from the search results
    selectCard(card) {
        const cellIndex = this.currentCell;
        const cell = this.grid[cellIndex];

        if (cell.solved) {
            return;
        }

        // Save the card details to the cell
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

    // Checks if the selected card is correct for the cell
    submitGuess(cellIndex) {
        const cell = this.grid[cellIndex];
        const rowIndex = Math.floor(cellIndex / 3);
        const colIndex = cellIndex % 3;
        const rowCrit = this.rowCriteria[rowIndex];
        const colCrit = this.colCriteria[colIndex];

        // Check if the card matches both the row and column rules
        const validation = this.validateCard(cell.selectedCard, rowCrit, colCrit);

        if (validation.isValid) {
            this.handleCorrectGuess(cellIndex, cell);
        } else {
            this.handleIncorrectGuess(cellIndex, cell, rowIndex, colIndex, validation);
        }

        this.updateStats();
    }

    // Helper: Checks if a card matches the specific row and column rules
    validateCard(card, rowCrit, colCrit) {
        const rowMatch = this.checkSingleCriteria(card, rowCrit);
        const colMatch = this.checkSingleCriteria(card, colCrit);

        return { isValid: rowMatch && colMatch, rowMatch, colMatch };
    }

    // Checks one specific rule (e.g. "Is it Blue?" or "Is CMC > 5?")
    checkSingleCriteria(card, criteria) {
        if (!criteria || !criteria.code) return true;
        const code = criteria.code;

        // Check Color
        if (code.startsWith('c:')) {
            const color = code.split(':')[1].toUpperCase();
            const cardColors = (card.colors || []).map(c => c.toUpperCase());
            return cardColors.includes(color);
        }

        // Check Type
        if (code.startsWith('type:')) {
            const type = code.split(':')[1].toLowerCase();
            return card.type.toLowerCase().includes(type);
        }

        // Check Mana Value (CMC)
        if (code.startsWith('mv')) {
            const val = parseInt(code.match(/\d+/)[0]);
            const cardMVC = card.cmc !== undefined ? card.cmc : 0;
            if (code.includes('<=')) return cardMVC <= val;
            if (code.includes('>=')) return cardMVC >= val;
            if (code.includes('<')) return cardMVC < val;
            if (code.includes('>')) return cardMVC > val;
            return cardMVC === val;
        }

        // Check Release Year
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

    // What happens when the player guesses correctly
    handleCorrectGuess(cellIndex, cell) {
        if (!cell.solved) {
            cell.solved = true;
            this.totalSolved++;
        }

        const gridCellBtn = document.querySelectorAll('.grid-cell')[cellIndex];
        gridCellBtn.classList.add('solved');
        gridCellBtn.disabled = true;

        // Use template literal for cleaner DOM generation
        gridCellBtn.innerHTML = `
            <img src="${cell.selectedCard.imageUrl}" alt="${cell.selectedCard.name}" class="grid-cell-image">
            <div class="grid-cell-name">${cell.selectedCard.name}</div>
            <div class="grid-cell-status">✓</div>
        `;

        if (this.totalSolved === 9) this.winGame();
    }

    // What happens when the player guesses incorrectly
    handleIncorrectGuess(cellIndex, cell, rowIndex, colIndex, validation) {
        const gridCellBtn = document.querySelectorAll('.grid-cell')[cellIndex];

        // If they ran out of guesses
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
            // Just a wrong guess, show animation
            gridCellBtn.classList.add('error');

            // Visual feedback on which criteria failed
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

            // Remove small error state from the button after animation
            setTimeout(() => gridCellBtn.classList.remove('error'), 700);
        }
    }

    // Updates the "Guesses: X/6" and "Solved: Y/9" counters
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

    // Show the "You Won" popup
    winGame() {
        setTimeout(() => {
            const modal = document.getElementById('gameOverModal');
            document.getElementById('gameOverTitle').textContent = '🎉 You Won!';
            document.getElementById('gameOverMessage').textContent =
                `Congratulations! You solved all 9 cards with ${this.getTotalGuesses()} total guesses.`;

            modal.classList.remove('hidden');
        }, 500);
    }

    // Show the "Game Over" popup
    loseGame() {
        setTimeout(() => {
            const modal = document.getElementById('gameOverModal');
            document.getElementById('gameOverTitle').textContent = '😢 Game Over';
            document.getElementById('gameOverMessage').textContent =
                `You ran out of guesses on a cell. The correct cards were: ${this.getGameOverCards()}`;

            modal.classList.remove('hidden');
        }, 500);
    }

    // Calculates total guesses made so far
    getTotalGuesses() {
        return this.grid.reduce((total, cell) => total + cell.guessCount, 0);
    }

    // Gets a list of cards that were supposed to be found (for the game over screen)
    getGameOverCards() {
        return this.grid.filter(c => !c.solved && c.targetCard).map(c => c.targetCard.name).join(', ');
    }
}

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', () => {
    new MTGDokuGame();
});
