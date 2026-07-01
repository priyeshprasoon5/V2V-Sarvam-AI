import { VoiceAssistant } from '../components/VoiceAssistant';

export default function Home() {
  return (
    <main className="min-h-screen w-full flex items-center justify-center relative py-12 px-4 select-none">
      
      {/* Ambient background glow blobs */}
      <div 
        className="glow-blob w-[500px] h-[500px] bg-purple-900/10 top-[-100px] left-[5%] animate-pulse-slow" 
        style={{ animationDelay: '0s' }}
      />
      <div 
        className="glow-blob w-[600px] h-[600px] bg-cyan-900/10 bottom-[-100px] right-[5%] animate-pulse-slow" 
        style={{ animationDelay: '2s' }}
      />
      <div 
        className="glow-blob w-[300px] h-[300px] bg-pink-900/5 top-[40%] left-[40%] animate-pulse-slow" 
        style={{ animationDelay: '1s' }}
      />

      {/* Orbiting space dust highlights */}
      <div className="absolute top-[20%] left-[20%] w-1.5 h-1.5 rounded-full bg-cyan-400 opacity-30 animate-float" />
      <div className="absolute bottom-[25%] right-[25%] w-2 h-2 rounded-full bg-purple-400 opacity-20 animate-float" style={{ animationDelay: '3s' }} />
      <div className="absolute top-[60%] right-[15%] w-1 h-1 rounded-full bg-pink-400 opacity-40 animate-float" style={{ animationDelay: '1.5s' }} />

      {/* Main interface layout */}
      <VoiceAssistant />
      
    </main>
  );
}
