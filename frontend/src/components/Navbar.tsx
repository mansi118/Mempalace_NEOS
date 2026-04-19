interface Props {
  onSearchClick: () => void;
  palaceName?: string;
}

export default function Navbar({ onSearchClick, palaceName }: Props) {
  return (
    <nav className="fixed top-0 left-0 right-0 h-[70px] flex items-center justify-between px-6 bg-[rgba(10,10,10,0.85)] backdrop-blur-[20px] border-b border-border z-50">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand to-brand-dark flex items-center justify-center text-sm font-bold text-black">
          P
        </div>
        <span className="text-lg font-bold tracking-tight">PALACE</span>
        {palaceName && (
          <span className="text-text-secondary text-sm hidden sm:inline">
            / {palaceName}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onSearchClick}
          className="flex items-center gap-2 px-4 py-2 rounded-[10px] bg-bg-card border border-border text-text-secondary text-sm hover:border-border-subtle hover:text-text-primary transition-colors cursor-pointer"
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          Search memories...
          <kbd className="ml-2 px-1.5 py-0.5 rounded bg-bg-elevated text-[10px] font-mono text-text-tertiary border border-border">
            /K
          </kbd>
        </button>
      </div>
    </nav>
  );
}
