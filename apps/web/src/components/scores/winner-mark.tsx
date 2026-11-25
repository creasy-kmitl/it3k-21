/** Marks the winner of a pair match reported only by who won: a green frame around "ชนะ". */
export function WinnerMark() {
  return (
    <span className="rounded-full border border-green-600 bg-green-500/10 px-3 py-0.5 text-sm font-semibold text-green-700 dark:border-green-500 dark:text-green-400">
      ชนะ
    </span>
  );
}
