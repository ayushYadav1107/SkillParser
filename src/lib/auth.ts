import { useState, useEffect } from 'react';

export type UserRole = 'recruiter' | 'candidate' | null;

export const AUTH_STORAGE_KEY = 'skillparser_auth_role';
export const USER_EMAIL_KEY = 'skillparser_auth_email';
export const USER_NAME_KEY = 'skillparser_auth_name';

export function useAuth() {
  const [role, setRole] = useState<UserRole>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    try {
      const storedRole = localStorage.getItem(AUTH_STORAGE_KEY) as UserRole;
      const storedEmail = localStorage.getItem(USER_EMAIL_KEY);
      const storedName = localStorage.getItem(USER_NAME_KEY);
      if (storedRole) setRole(storedRole);
      if (storedEmail) setEmail(storedEmail);
      if (storedName) setName(storedName);
    } catch {}
    setIsLoaded(true);
  }, []);

  const login = (newRole: UserRole, newEmail: string, newName?: string) => {
    try {
      if (newRole) {
        localStorage.setItem(AUTH_STORAGE_KEY, newRole);
        localStorage.setItem(USER_EMAIL_KEY, newEmail);
        if (newName) localStorage.setItem(USER_NAME_KEY, newName);
      } else {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        localStorage.removeItem(USER_EMAIL_KEY);
        localStorage.removeItem(USER_NAME_KEY);
      }
    } catch {}
    setRole(newRole);
    setEmail(newEmail);
    if (newName !== undefined) setName(newName);
  };

  const logout = () => {
    login(null, '');
  };

  return { role, email, name, isLoaded, login, logout };
}
