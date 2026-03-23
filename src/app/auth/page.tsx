"use client";

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { UserRole, useAuth } from '@/lib/auth';
import { BrainCircuit, Briefcase, Mail, Lock } from 'lucide-react';

export default function AuthPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultMode = searchParams.get('mode') as UserRole || 'candidate';
  const { login } = useAuth();
  
  const [mode, setMode] = useState<UserRole>(defaultMode);
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    if (isSignup && (!firstName || !lastName)) return;
    
    const fullName = isSignup ? `${firstName} ${lastName}` : 'System User';

    // Simulate API call
    setTimeout(() => {
      login(mode, email, fullName);
      router.push('/analyzer'); // Send them to the dashboard/analyzer
    }, 500);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8 flex flex-col items-center">
          <div className="flex items-center gap-2 mb-4 bg-white px-4 py-2 rounded-2xl shadow-sm border border-border">
            <BrainCircuit className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold text-primary">SkillParser</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            {isSignup ? 'Create an account' : 'Welcome back'}
          </h1>
          <p className="text-muted-foreground mt-2">
            Please enter your details to sign in.
          </p>
        </div>

        <Card className="shadow-lg border-muted">
          <CardHeader className="pb-4">
            <div className="flex bg-slate-100 p-1 rounded-lg">
              <button
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all ${
                  mode === 'candidate' 
                    ? 'bg-white text-slate-900 shadow-sm' 
                    : 'text-muted-foreground hover:text-slate-900'
                }`}
                onClick={() => setMode('candidate')}
              >
                <BrainCircuit className="h-4 w-4" />
                Candidate
              </button>
              <button
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all ${
                  mode === 'recruiter' 
                    ? 'bg-white text-slate-900 shadow-sm' 
                    : 'text-muted-foreground hover:text-slate-900'
                }`}
                onClick={() => setMode('recruiter')}
              >
                <Briefcase className="h-4 w-4" />
                Recruiter
              </button>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {isSignup && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium leading-none">First Name</label>
                    <Input 
                      placeholder="Ronit" 
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required={isSignup}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium leading-none">Last Name</label>
                    <Input 
                      placeholder="Kumar" 
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      required={isSignup}
                    />
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    type="email" 
                    placeholder="name@example.com" 
                    className="pl-9"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium leading-none">Password</label>
                  {!isSignup && (
                    <a href="#" className="text-xs text-primary hover:underline">Forgot password?</a>
                  )}
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    type="password"
                    placeholder="••••••••" 
                    className="pl-9"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>
              
              <Button type="submit" className="w-full mt-6 bg-primary font-semibold text-primary-foreground h-11">
                {isSignup ? 'Sign Up' : 'Sign In'}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="flex justify-center border-t border-border pt-6 pb-6 bg-slate-50 rounded-b-xl">
            <p className="text-sm text-muted-foreground">
              {isSignup ? "Already have an account? " : "Don't have an account? "}
              <button 
                onClick={() => setIsSignup(!isSignup)}
                className="text-primary font-semibold hover:underline"
              >
                {isSignup ? "Sign In" : "Sign Up"}
              </button>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
