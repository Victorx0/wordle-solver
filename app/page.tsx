"use client"
import Image from "next/image";
import { Input } from "@/components/ui/input";
import { useState, useEffect, useRef, useMemo } from "react";
import useFetch from "@/components/web/useFetch";

const colorClasses: { [key: number]: string } = {
  0: "bg-blue-50",
  1: "bg-yellow-500",
  2: "bg-green-500",
};

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
          setErrorMessage("word not in database")
        } else {
          setisError(false)
          computeSuggested()
          setRow(prev => prev + 1); // Move to next row
        }
      } else {
        setisError(true)
        setErrorMessage("must be 5 letters")
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



  return (
    <div className="py-3 w-full flex flex-col items-center justify-center my-3">
        <div className="text-6xl">
          Wordle Solver
        </div>
        <div>click on the squares and match the colours to your guess</div>
        {isLoading ? (
          <div className="flex items-center gap-2">
            <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>
            <span>Calculating best guess...</span>
          </div>
        ) : (
          <div className="text-center">
            <div>Suggested Guess: <span className="font-bold text-green-600">{suggestedWord}</span></div>
            <div>Possible Words: <span className="font-bold">{filteredWords.length}</span></div>
          </div>
          
        )}
        <div className="py-2 w-full flex flex-col items-center justify-center my-2 gap-2">
          {guess.map((word, rowIndex) => (
            <div key={rowIndex} className="flex gap-5 overflow-hidden">
              {[0, 1, 2, 3, 4].map((colIndex) => (
                <div
                  key={colIndex}
                  onClick={() => changeColours(rowIndex, colIndex)}
                  className={`w-20 h-20 ${colorClasses[colours[rowIndex][colIndex]]} flex items-center justify-center text-6xl cursor-pointer`}
                >
                  <span>{word[colIndex] || ""}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      <div>
        
      </div>
      <div className="w-0">
        <div className="z-10 relative">
          <Input className="text-xl opacity-0 pointer-events-none" ref={inputRef} value={guess[row]} onChange={handleChange} onKeyDown={handleKeyDown} onBlur={(e) => e.target.focus()}placeholder="guess word here"></Input>
        </div>
      </div>
      {isError && (
        <div className="font-bold text-red-500">{errorMessage}</div>
      )}
    </div>
  );
}
