import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, LogIn } from 'lucide-react'
import { useAuth } from '@/lib/auth'

const demoAccounts = [
  { email: 'operator@sentinel.dev', label: 'Operator', desc: 'Triage & assess' },
  { email: 'engineer@sentinel.dev', label: 'Engineer', desc: 'Draft & simulate' },
  { email: 'itsupport@sentinel.dev', label: 'IT Support', desc: 'Incident triage' },
  { email: 'approver@sentinel.dev', label: 'Approver', desc: 'Change approvals' },
  { email: 'accessapprover@sentinel.dev', label: 'Access Approver', desc: 'Access decisions' },
  { email: 'admin@sentinel.dev', label: 'Admin', desc: 'Full control' },
]

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      await login(email, password)
      navigate('/')
    } catch (err: any) {
      setError(err?.message?.includes('Invalid') ? 'Invalid email or password' : 'Login failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleQuickLogin(accountEmail: string) {
    setEmail(accountEmail)
    setPassword('password')
    // Auto-submit after setting
    setError('')
    setIsSubmitting(true)
    login(accountEmail, 'password')
      .then(() => navigate('/'))
      .catch(() => setError('Login failed'))
      .finally(() => setIsSubmitting(false))
  }

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 mb-4">
            <Shield className="w-8 h-8 text-accent" />
          </div>
          <h1 className="text-3xl font-bold text-text-primary">Sentinel</h1>
          <p className="text-text-secondary mt-2">Policy-enforced operational control plane</p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="bg-bg-secondary border border-border-primary rounded-xl p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-bg-primary border border-border-primary rounded-lg text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              placeholder="email@sentinel.dev"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-bg-primary border border-border-primary rounded-lg text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <div className="text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
          >
            <LogIn className="w-4 h-4" />
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        {/* Quick Login */}
        <div className="bg-bg-secondary border border-border-primary rounded-xl p-6">
          <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-3">Quick login — demo accounts</p>
          <div className="grid grid-cols-2 gap-2">
            {demoAccounts.map(account => (
              <button
                key={account.email}
                onClick={() => handleQuickLogin(account.email)}
                disabled={isSubmitting}
                className="flex flex-col items-start px-3 py-2.5 bg-bg-primary hover:bg-bg-tertiary border border-border-primary rounded-lg transition-colors text-left disabled:opacity-50"
              >
                <span className="text-sm font-medium text-text-primary">{account.label}</span>
                <span className="text-xs text-text-tertiary">{account.desc}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-text-tertiary mt-3 text-center">All accounts use password: <code className="text-text-secondary">password</code></p>
        </div>
      </div>
    </div>
  )
}
