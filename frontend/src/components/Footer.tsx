export default function Footer() {
  return (
    <footer className="border-t border-border mt-20">
      <div className="max-w-[1280px] mx-auto px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div>
            <h4 className="text-sm font-semibold mb-3">Palace</h4>
            <ul className="space-y-2 text-sm text-text-secondary">
              <li><a href="#" className="hover:text-white transition-colors">Dashboard</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Search</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Browse Wings</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Stats</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-3">Data</h4>
            <ul className="space-y-2 text-sm text-text-secondary">
              <li><a href="#" className="hover:text-white transition-colors">Ingest</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Export</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Quarantine</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Monitoring</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-3">Stack</h4>
            <ul className="space-y-2 text-sm text-text-secondary">
              <li>Convex</li>
              <li>FalkorDB</li>
              <li>Qwen Embeddings</li>
              <li>MCP Protocol</li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-3">NeuralEDGE</h4>
            <ul className="space-y-2 text-sm text-text-secondary">
              <li>NEOS Platform</li>
              <li>NEop Agents</li>
              <li>Context Vault</li>
              <li>Synlex Technologies</li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-border flex items-center justify-between text-text-tertiary text-xs">
          <span>PALACE v1.0 — Context Vault for NEops</span>
          <span>Built by NeuralEDGE</span>
        </div>
      </div>
    </footer>
  );
}
