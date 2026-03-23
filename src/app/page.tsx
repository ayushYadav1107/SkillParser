import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { FileText, Search, Cpu, BarChart3, ShieldCheck, Zap, BrainCircuit, ArrowRight, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-white">
      {/* Header */}
      <header className="px-6 lg:px-12 h-20 flex items-center border-b sticky top-0 z-50 bg-white/80 backdrop-blur-md">
        <Link className="flex items-center justify-center gap-2" href="/">
          <BrainCircuit className="h-8 w-8 text-secondary" />
          <span className="text-2xl font-black tracking-tighter text-primary">SkillParser</span>
        </Link>
        <nav className="ml-auto flex gap-8">
          <Link className="text-sm font-bold text-primary hover:text-secondary transition-colors" href="/analyzer">
            Screener
          </Link>
          <Link className="text-sm font-bold text-muted-foreground hover:text-primary transition-colors" href="#features">
            Features
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden pt-20 pb-32">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-secondary/5 rounded-full blur-3xl -z-10" />
          <div className="container px-6 mx-auto">
            <div className="flex flex-col items-center text-center max-w-4xl mx-auto space-y-8">
              <Badge className="bg-primary/10 text-primary border-none py-1.5 px-4 rounded-full font-bold text-xs uppercase tracking-widest">
                AI-Driven Applicant Tracking
              </Badge>
              <h1 className="text-5xl md:text-7xl font-black tracking-tight text-primary leading-[1.1]">
                Stop Reading Resumes. <br />
                <span className="text-secondary">Start Hiring Talent.</span>
              </h1>
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                Automate your entire screening pipeline with Gemini-powered semantic matching. 
                Extract data with 99% accuracy and find the perfect match in seconds.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 pt-4">
                <Button size="lg" className="bg-primary hover:bg-primary/90 rounded-full px-12 h-14 text-lg font-bold" asChild>
                  <Link href="/auth?mode=candidate">Login as Candidate</Link>
                </Button>
                <Button size="lg" variant="outline" className="rounded-full px-12 h-14 text-lg font-bold border-2" asChild>
                  <Link href="/auth?mode=recruiter">Login as Recruiter</Link>
                </Button>
              </div>
              
              <div className="flex items-center gap-8 pt-12 text-muted-foreground">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="h-5 w-5 text-secondary" /> 100% Data Privacy
                </div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="h-5 w-5 text-secondary" /> 99.9% Parser Accuracy
                </div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="h-5 w-5 text-secondary" /> Gemini 2.0 Support
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Value Prop Section */}
        <section id="features" className="w-full py-24 bg-muted/30">
          <div className="container px-6 mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
              <div className="space-y-8">
                <h2 className="text-4xl font-black tracking-tight text-primary leading-tight">
                  The semantic matching engine <br /> 
                  built for high-growth teams.
                </h2>
                <div className="space-y-6">
                  <div className="flex gap-4">
                    <div className="h-12 w-12 rounded-2xl bg-white shadow-sm flex items-center justify-center shrink-0">
                      <Zap className="h-6 w-6 text-secondary" />
                    </div>
                    <div>
                      <h4 className="font-bold text-lg text-primary">Instant Parsing</h4>
                      <p className="text-muted-foreground">Convert messy PDFs into clean, structured JSON schemas automatically.</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="h-12 w-12 rounded-2xl bg-white shadow-sm flex items-center justify-center shrink-0">
                      <BarChart3 className="h-6 w-6 text-secondary" />
                    </div>
                    <div>
                      <h4 className="font-bold text-lg text-primary">Weighted Scoring</h4>
                      <p className="text-muted-foreground">Customizable ranking based on specific experience, education, and skills.</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="h-12 w-12 rounded-2xl bg-white shadow-sm flex items-center justify-center shrink-0">
                      <ShieldCheck className="h-6 w-6 text-secondary" />
                    </div>
                    <div>
                      <h4 className="font-bold text-lg text-primary">Bias Suppression</h4>
                      <p className="text-muted-foreground">Focus strictly on qualifications with AI-driven anonymization features.</p>
                    </div>
                  </div>
                </div>
                <Button variant="link" className="text-secondary font-bold text-lg p-0 group" asChild>
                  <Link href="/analyzer">See how it works <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" /></Link>
                </Button>
              </div>
              
              <div className="relative">
                 <div className="absolute -inset-4 bg-primary/5 rounded-[2rem] -z-10 blur-xl" />
                 <Card className="border-none shadow-2xl overflow-hidden rounded-[2rem]">
                   <CardHeader className="bg-primary text-white p-8">
                     <CardTitle className="text-2xl font-black">Match Report</CardTitle>
                   </CardHeader>
                   <CardContent className="p-8 space-y-6">
                     <div className="flex items-center justify-between">
                       <div className="flex items-center gap-4">
                         <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center font-bold text-white">94</div>
                         <div>
                           <p className="font-bold text-primary">Madhav Verma</p>
                           <p className="text-xs text-muted-foreground">Senior Software Engineer</p>
                         </div>
                       </div>
                       <Badge className="bg-secondary/10 text-secondary border-none">High Match</Badge>
                     </div>
                     <Separator />
                     <div className="space-y-3">
                       <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Top Skills</p>
                       <div className="flex flex-wrap gap-2">
                         <Badge variant="outline">React.js</Badge>
                         <Badge variant="outline">Next.js</Badge>
                         <Badge variant="outline">TensorFlow</Badge>
                         <Badge variant="outline">Cloud Arch</Badge>
                       </div>
                     </div>
                   </CardContent>
                 </Card>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-12 px-6 border-t bg-white">
        <div className="container mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-6 w-6 text-secondary" />
            <span className="text-xl font-black tracking-tighter text-primary">SkillParser</span>
          </div>
          <p className="text-sm text-muted-foreground">© 2026 SkillParser AI. Built for the future of work.</p>
          <div className="flex gap-8">
            <Link className="text-xs font-bold hover:text-primary transition-colors" href="#">Terms</Link>
            <Link className="text-xs font-bold hover:text-primary transition-colors" href="#">Privacy</Link>
            <Link className="text-xs font-bold hover:text-primary transition-colors" href="#">Twitter</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Badge({ children, className, variant }: any) {
  return (
    <div className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2", className)}>
      {children}
    </div>
  );
}
