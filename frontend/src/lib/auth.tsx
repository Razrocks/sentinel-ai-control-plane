import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import { apiFetch } from './api'

interface AuthUser {
  id: string
  email: string
  name: string
  role: string
  team: string
}

interface AuthContextValue {
  user: AuthUser | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Store access token in memory (not localStorage for security)
let accessToken: string | null = null

export function getToken() {
  return accessToken
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Try to restore session on mount via refresh token
  useEffect(() => {
    tryRefresh()
  }, [])

  async function tryRefresh() {
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/auth/refresh`,
        { method: 'POST', credentials: 'include' }
      )
      if (res.ok) {
        const data = await res.json()
        accessToken = data.accessToken
        setUser(data.user)
      }
    } catch {
      // No valid refresh token — user needs to login
    } finally {
      setIsLoading(false)
    }
  }

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiFetch<{ accessToken: string; user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    })
    accessToken = data.accessToken
    setUser(data.user)
  }, [])

  const logout = useCallback(async () => {
    try {
      await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/auth/logout`,
        { method: 'POST', credentials: 'include' }
      )
    } catch {
      // Best effort
    }
    accessToken = null
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
