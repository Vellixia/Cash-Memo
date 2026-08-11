import { useState, useCallback } from "react";

export interface ResultsChangedBoundaryProps {
  readonly onRestart: () => void;
  readonly children: React.ReactNode;
}

export function ResultsChangedBoundary({ onRestart, children }: ResultsChangedBoundaryProps) {
  const [resultsChanged, setResultsChanged] = useState(false);

  const handleRestart = useCallback(() => {
    setResultsChanged(false);
    onRestart();
  }, [onRestart]);

  if (resultsChanged) {
    return (
      <div data-testid="results-changed">
        <p>The results have changed. Your previous pages may no longer be accurate.</p>
        <button data-testid="restart-traversal" onClick={handleRestart}>
          Refresh results
        </button>
      </div>
    );
  }

  return <div data-testid="results-active">{children}</div>;
}

export function useResultsChangedHandler() {
  const [resultsChanged, setResultsChanged] = useState(false);
  const trigger = useCallback(() => setResultsChanged(true), []);
  const reset = useCallback(() => setResultsChanged(false), []);
  return { resultsChanged, reset, trigger };
}
