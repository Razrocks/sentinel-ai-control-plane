/**
 * Login — preset-style auth card.
 *
 * shadcn primitives throughout: Card, Input, Label, Button, Alert.
 * Quick-login grid uses outline Buttons so each one looks tappable.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, LogIn, AlertCircle } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

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
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setError(msg.includes('Invalid') ? 'Invalid email or password' : 'Login failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleQuickLogin(accountEmail: string) {
    setEmail(accountEmail)
    setPassword('password')
    setError('')
    setIsSubmitting(true)
    login(accountEmail, 'password')
      .then(() => navigate('/'))
      .catch(() => setError('Login failed'))
      .finally(() => setIsSubmitting(false))
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md flex flex-col gap-8">
        {/* Brand */}
        <div className="flex flex-col items-center text-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <Shield className="h-7 w-7" />
          </div>
          <h1 className="font-heading text-3xl font-medium tracking-tight text-foreground">
            Sentinel
          </h1>
          <p className="text-sm text-muted-foreground">
            Policy-enforced operational control plane
          </p>
        </div>

        {/* Login form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sign in</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@sentinel.dev"
                  required
                  style={{ height: '2.5rem' }}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  style={{ height: '2.5rem' }}
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" disabled={isSubmitting} className="w-full" size="lg">
                <LogIn />
                {isSubmitting ? 'Signing in...' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Quick login */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Quick login · demo accounts
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              {demoAccounts.map((account) => (
                <Button
                  key={account.email}
                  type="button"
                  variant="outline"
                  onClick={() => handleQuickLogin(account.email)}
                  disabled={isSubmitting}
                  className="h-auto flex-col items-start py-3 gap-1 text-left"
                >
                  <span className="text-sm font-medium text-foreground">{account.label}</span>
                  <span className="text-xs text-muted-foreground font-normal">{account.desc}</span>
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-center">
              All accounts use password:{' '}
              <code className="text-foreground rounded bg-muted px-1.5 py-0.5 font-mono">
                password
              </code>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
