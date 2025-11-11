export default function Footer(){
  return (
    <footer className="mt-16 border-t border-neutral-800">
      <div className="container mx-auto p-4 text-xs opacity-70">
        <div>© {new Date().getFullYear()} Hemi UniV3-compatible Frontend</div>
      </div>
    </footer>
  )
}