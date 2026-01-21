import Papa from "papaparse";

type Callback = (data: any[]) => void;

const useFetch = () => {
    const fetchCsvData = (filePath: string, callback: Callback) => {
        // Papa.parse can take a URL directly if 'download: true' is set
        Papa.parse(filePath, {
            download: true,
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true,
            complete: (results) => {
                // This is where your data actually lives
                callback(results.data);
            },
            error: (error) => {
                console.error("PapaParse Error:", error.message);
            }
        });
    }
    return { fetchCsvData };
}

export default useFetch;