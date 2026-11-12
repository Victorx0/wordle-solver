"use client"
import Image from "next/image";
import { Input } from "@/components/ui/input";
import { useState, useEffect, useRef, useMemo } from "react";
import useFetch from "@/components/web/useFetch";

// Colour patterns are encoded as base-3 integers (0..242): digit i = colour of letter i.
const POW3 = [1, 3, 9, 27, 81];

// Reusable scratch buffers so the hot path allocates nothing.
const letterCounts = new Uint8Array(26);
const isGreen = new Uint8Array(5);
const patternBuckets = new Int32Array(243);

const encodeWord = (word: string): Uint8Array =>
  Uint8Array.from(word, (c) => c.charCodeAt(0) - 97);

const encodeColours = (colours: number[]): number =>
  colours.reduce((code, c, i) => code + c * POW3[i], 0);

// Returns the colour pattern `guess` would produce against `target`, as a base-3 integer.
const patternCode = (guess: Uint8Array, target: Uint8Array): number => {
  letterCounts.fill(0);
  let code = 0;

  // PASS 1: greens; count the target's non-green letters
  for (let i = 0; i < 5; i++) {
    if (guess[i] === target[i]) {
      isGreen[i] = 1;
      code += 2 * POW3[i];
    } else {
      isGreen[i] = 0;
      letterCounts[target[i]]++;
    }
  }

  // PASS 2: yellows from the remaining letter counts
  for (let i = 0; i < 5; i++) {
    if (!isGreen[i] && letterCounts[guess[i]] > 0) {
      code += POW3[i];
      letterCounts[guess[i]]--;
    }
  }

  return code;
};

const calculateEntropy = (guess: Uint8Array, possibleWords: Uint8Array[]): number => {
  patternBuckets.fill(0);
  for (const word of possibleWords) {
    patternBuckets[patternCode(guess, word)]++;
  }

  const total = possibleWords.length;
  let entropy = 0;
  for (let i = 0; i < 243; i++) {
    const count = patternBuckets[i];
    if (count) {
      const probability = count / total;
      entropy -= probability * Math.log2(probability);
    }
  }
  return entropy;
};

export default function Home() {
  const maxwords = 5
  const [row, setRow] = useState(0)
  const [guess, setGuess] = useState<string[]>(["","","","","",""])
  const [rawAllWordData, setRawAllWordData] = useState<any[]>([])
  const [allWordData, setAllWordData] = useState<string[]>([])
  const [colours, setColours] = useState<number[][]>([[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]])
  const [filteredWords, setFilteredWords] = useState<string[]>([])
  const [suggestedWord, setSuggestedWord] = useState<string>("tarse")
  const inputRef = useRef<HTMLInputElement>(null);
  const {fetchCsvData} = useFetch()
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setisError] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")

  useEffect(() =>{
    inputRef.current?.focus()
    fetchCsvData('/data/words.csv', setRawAllWordData)
  }, [])

  useEffect(() => { 
    if (rawAllWordData.length > 0) {
      const stringList = rawAllWordData
        .map((item) => item.Word?.toString().trim().toLowerCase()) // Trim whitespace!
        .filter((word) => word && word.length === 5); // Ensure only 5-letter words
      
      setFilteredWords(stringList);
      setAllWordData(stringList);
    }
  }, [rawAllWordData]);

  // Letter-code version of the word list, computed once when the list loads.
  const encodedWords = useMemo(() => allWordData.map(encodeWord), [allWordData]);

  const changeColours = (numRow : number, num : number) =>{
    if(numRow == row){
      const newColour = [...colours]
      if(colours[numRow][num] == 2)
        newColour[numRow][num] = 0
      else{
        newColour[numRow][num] += 1
      }
      setColours(newColour)
    }
  }

  const handleChange = (e: any) => {
    const val = e.target.value.toLowerCase();
    console.log(val)
    if (val.length <= 5) {
      const newGuessArray = [...guess]; 
      newGuessArray[row] = val;
      setGuess(newGuessArray);
    }
  };

  const handleKeyDown = (e: any) => {
    if (e.key === "Enter") {
      if (guess[row].length === 5) {
        if(!allWordData.includes(guess[row])){
          console.log("Must be valid word")
          setisError(true)
          setErrorMessage("Not in word list")
        } else {
          setisError(false)
          computeSuggested()
          setRow(prev => prev + 1); // Move to next row
        }
      } else {
        setisError(true)
        setErrorMessage("Not enough letters")
        console.log("Word must be 5 letters");
      }
    }
  };

const findBestEntropyGuess = (newFilter : string[]) => {
  let bestWord = "";
  let maxEntropy = -1;
  const encodedCandidates = newFilter.map(encodeWord);

  // We test every valid word to see which one is the best "splitter"
  for(let i = 0; i < encodedWords.length; i++) {
    const score = calculateEntropy(encodedWords[i], encodedCandidates);
    if (score > maxEntropy) {
      maxEntropy = score;
      bestWord = allWordData[i];
    }
  }

  setSuggestedWord(bestWord);
};
  
  const computeSuggested = () => {
    const currentGuess = guess[row].toLowerCase().trim();
    const encodedGuess = encodeWord(currentGuess);
    const targetPattern = encodeColours(colours[row]);

    const newFilter = filteredWords.filter(
      (candidate) => patternCode(encodedGuess, encodeWord(candidate)) === targetPattern
    );
    setFilteredWords(newFilter)
    if(newFilter.length == 0){
      setSuggestedWord("no word possible")
    }
    else if(newFilter.length <= 2){
      setSuggestedWord(newFilter[0])
    } else {
      setIsLoading(true)
      setTimeout(() => {
        findBestEntropyGuess(newFilter)
        setIsLoading(false)
      }, 100)
    }
    console.log(newFilter)
  }



  const hasSuggestion = /^[a-z]{5}$/.test(suggestedWord);

  return (
    <div className="min-h-dvh w-full flex flex-col items-center text-(--w-ink)">
      {/* Header */}
      <header className="w-full border-b border-(--w-border)">
        <div className="mx-auto max-w-xl px-4 py-3 sm:py-4 text-center">
          <h1 className="font-(family-name:--font-display) font-black tracking-tight text-3xl sm:text-4xl leading-none">
            Wordle Solver
          </h1>
          <p className="mt-1.5 text-xs sm:text-sm text-(--w-muted)">
            Tap each tile to match the colours from your game
          </p>
        </div>
      </header>

      <main className="w-full max-w-xl flex-1 flex flex-col items-center px-4 py-4 sm:py-6 gap-4 sm:gap-6">
        {/* Stats */}
        <section className="w-full grid grid-cols-2 border border-(--w-border) divide-x divide-(--w-border) min-h-19">
          {isLoading ? (
            <div className="col-span-2 flex items-center justify-center gap-2 text-sm text-(--w-muted)">
              <div className="animate-spin h-4 w-4 border-2 border-(--w-green) border-t-transparent rounded-full" />
              <span>Calculating best guess…</span>
            </div>
          ) : (
            <>
              <div className="flex flex-col items-center justify-center gap-1.5 py-2.5 px-2">
                <span className="text-[0.65rem] sm:text-xs font-semibold uppercase tracking-[0.12em] text-(--w-muted)">
                  Suggested Guess
                </span>
                {hasSuggestion ? (
                  <span className="flex gap-1">
                    {suggestedWord.split("").map((ch, i) => (
                      <span key={i} className="mini-tile bg-(--w-green)">{ch}</span>
                    ))}
                  </span>
                ) : (
                  <span className="text-sm font-bold capitalize">{suggestedWord}</span>
                )}
              </div>
              <div className="flex flex-col items-center justify-center gap-1 py-2.5 px-2">
                <span className="text-[0.65rem] sm:text-xs font-semibold uppercase tracking-[0.12em] text-(--w-muted)">
                  Possible Words
                </span>
                <span className="text-2xl sm:text-3xl font-bold tabular-nums leading-none">
                  {filteredWords.length.toLocaleString()}
                </span>
              </div>
            </>
          )}
        </section>

        {/* Board */}
        <div className="board" onClick={() => inputRef.current?.focus()}>
          {guess.map((word, rowIndex) => (
            <div key={rowIndex} className="board-row">
              {[0, 1, 2, 3, 4].map((colIndex) => {
                const letter = word[colIndex] || "";
                const showState = rowIndex < row || (rowIndex === row && letter !== "");
                return (
                  <div
                    key={colIndex}
                    onClick={() => changeColours(rowIndex, colIndex)}
                    className="tile"
                    data-filled={letter !== ""}
                    data-state={showState ? colours[rowIndex][colIndex] : undefined}
                    data-clickable={rowIndex === row}
                  >
                    {letter}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="w-0 h-0 overflow-hidden">
          <Input className="text-xl opacity-0 pointer-events-none" ref={inputRef} value={guess[row]} onChange={handleChange} onKeyDown={handleKeyDown} onBlur={(e) => e.target.focus()} placeholder="guess word here" autoCapitalize="none" autoComplete="off" spellCheck={false}></Input>
        </div>

        <div className="h-9 flex items-center">
          {isError && (
            <div className="rounded bg-(--w-ink) text-white text-sm font-bold px-4 py-2">
              {errorMessage}
            </div>
          )}
        </div>
      </main>

      {/* How-to guide */}
      <footer className="w-full border-t border-(--w-border)">
        <section className="mx-auto max-w-xl px-4 py-5 sm:py-6 text-sm leading-relaxed">
          <h2 className="font-(family-name:--font-display) font-bold text-lg sm:text-xl mb-3">
            How To Use
          </h2>
          <ol className="list-decimal pl-5 space-y-1.5 text-(--w-ink)/90">
            <li>Enter the suggested guess (or your own) in your Wordle game.</li>
            <li>Type the same word here.</li>
            <li>Tap each tile until its colour matches the result from your game.</li>
            <li>Press <kbd className="px-1.5 py-0.5 border border-(--w-border-filled) rounded text-xs font-semibold">Enter</kbd> to get the next best guess.</li>
          </ol>
          <div className="mt-4 grid gap-2 text-(--w-muted)">
            <div className="flex items-center gap-3">
              <span className="mini-tile bg-(--w-green)">W</span>
              <span>Correct letter in the correct spot.</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="mini-tile bg-(--w-yellow)">O</span>
              <span>Letter is in the word, but in a different spot.</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="mini-tile bg-(--w-grey)">R</span>
              <span>Letter is not in the word.</span>
            </div>
          </div>
        </section>
      </footer>
    </div>
  );
}
