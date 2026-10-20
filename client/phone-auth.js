/**
 * Memora phone authentication helpers, shared by desktop, PWA and Android.
 * All numbers use E.164 so global SMS providers receive an explicit country code.
 * Never store OTP values or phone numbers in Memora memories or analytics.
 */
export function normalizePhoneNumber(input) {
  const raw = String(input ?? '').trim()
  // Be permissive about formatting but not about missing international prefix.
  const stripped = raw.replace(/[\s().-]/g, '')
  if (!/^\+[1-9][0-9]{7,14}$/.test(stripped)) {
    throw new Error('Enter a mobile number with country code, for example +91 98765 43210.')
  }
  return stripped
}

export function normalizePhoneOtp(input) {
  const code = String(input ?? '').trim()
  if (!/^\d{6,8}$/.test(code)) {
    throw new Error('Enter the 6 to 8 digit code sent to your phone.')
  }
  return code
}

export async function requestPhoneOtp(auth, {phone, createAccount=false, displayName=''}) {
  const normalized = normalizePhoneNumber(phone)
  const options = {channel:'sms', shouldCreateUser:Boolean(createAccount)}
  if (createAccount && String(displayName||'').trim()) {
    options.data = {display_name:String(displayName).trim().slice(0,100)}
  }
  const {error} = await auth.signInWithOtp({phone:normalized, options})
  if (error) throw error
  return normalized
}

export async function confirmPhoneOtp(auth,{phone,code}) {
  const normalized = normalizePhoneNumber(phone)
  const token = normalizePhoneOtp(code)
  const {data,error} = await auth.verifyOtp({phone:normalized,token,type:'sms'})
  if (error) throw error
  if (!data?.session?.user) throw new Error('The verification could not complete. Please try again.')
  return data
}

export async function resendPhoneOtp(auth,{phone}) {
  const normalized = normalizePhoneNumber(phone)
  const {error} = await auth.resend({type:'sms',phone:normalized})
  if (error) throw error
  return normalized
}

export function phoneAuthError(error) {
  const original = String(error?.message || error || '')
  if (/phone (?:provider|sign.?in)|sms (?:provider|not configured)|unsupported phone|phone logins? are disabled|sms.*disabled/i.test(original)) {
    return 'SMS sign-in is not enabled yet. Memora must configure a phone provider and SMS delivery in Supabase.'
  }
  if (/rate.?limit|too many|429|security purposes|over_email_send_rate_limit|over_sms_send_rate_limit/i.test(original)) {
    return 'Too many requests. Wait before requesting another SMS code.'
  }
  if (/expired|invalid.*(?:otp|token)|token.*invalid/i.test(original)) {
    return 'That verification code is invalid or expired. Please check the SMS or request another.'
  }
  if (/user not found|signups? not allowed|user.*does not exist/i.test(original)) {
    return 'No account found for this mobile number. Select Create account first.'
  }
  return original.slice(0,300) || 'Unable to complete SMS verification. Please try again.'
}
