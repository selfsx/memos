export function View({ name }: { name: string }) {
  return (
    <div title="a // b">
      {/* XXX: the title must stay short */}
      <p>don't // this is text, http://x</p>
      {name}
    </div>
  )
}
