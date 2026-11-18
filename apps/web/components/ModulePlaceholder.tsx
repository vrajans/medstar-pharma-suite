export function ModulePlaceholder({ title, items }: { title: string; items: Array<[id: string, text: string, rel: string]> }) {
  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-1 text-xl font-semibold">{title}</h1>
      <p className="mb-4 text-sm text-muted">Use cases scheduled for this module (docs/02-prd-use-cases.md). Database functions are in supabase/migrations.</p>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface text-sm">
        {items.map(([id, text, rel]) => (
          <li key={id} className="flex justify-between p-3"><span><code className="mr-2 text-muted">{id}</code>{text}</span><span className="text-muted">{rel}</span></li>
        ))}
      </ul>
    </div>
  );
}
