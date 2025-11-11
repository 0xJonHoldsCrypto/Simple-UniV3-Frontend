export default function Toast({ message }:{ message:string }){
  if (!message) return null
  return <div className="fixed bottom-4 right-4 bg-neutral-800 text-sm px-3 py-2 rounded-2xl shadow">{message}</div>
}