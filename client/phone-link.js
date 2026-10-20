import { normalizePhoneNumber, normalizePhoneOtp } from './phone-auth.js'

// Change a logged-in user's phone identity. Never sign up a new account here.
// Email and Google users retain their original auth.users.id and memory vault.
export async function startPhoneLink(auth, { phone, expectedUserId }) {
  const normalized=normalizePhoneNumber(phone)
  if(!expectedUserId) throw new Error('Sign in before linking a mobile number.')
  const current=await auth.getUser()
  if(current.error || current.data?.user?.id!==expectedUserId)
    throw new Error('Your session changed. Sign in again before linking a number.')
  if(current.data.user.phone===normalized)
    throw new Error('This mobile number is already associated with your Memora account.')
  const response=await auth.updateUser({phone:normalized})
  if(response.error) throw response.error
  return normalized
}

export async function confirmPhoneLink(auth,{phone,token,expectedUserId}) {
  const normalized=normalizePhoneNumber(phone)
  const pin=normalizePhoneOtp(token)
  if(!expectedUserId) throw new Error('Sign in before verifying a number.')
  // A phone change must not accidentally switch to a separately created
  // account. Verify against the signed-in identity before and after OTP.
  const before=await auth.getUser()
  if(before.error||before.data?.user?.id!==expectedUserId)
    throw new Error('Your signed-in account changed. Sign in again.')
  const response=await auth.verifyOtp({phone:normalized,token:pin,type:'phone_change'})
  if(response.error) throw response.error
  const after=await auth.getUser()
  if(after.error||after.data?.user?.id!==expectedUserId)
    throw new Error('Account identity could not be confirmed. Stop and contact Memora support.')
  if(after.data.user.phone!==normalized)
    throw new Error('Mobile number could not be confirmed yet. Check the code or try again.')
  return after.data.user
}

export function maskedPhone(phone){
  const value=String(phone||'')
  if(!value)return ''
  return value.length>5?value.slice(0,3)+' •••• '+value.slice(-3):'••••'
}

export function phoneLinkMessage(err){
  const text=String(err?.message||err||'')
  if(/already|registered|taken|exists|unique|duplicate/i.test(text))
    return 'This number may already be linked to another account. Sign in with that account or contact support; Memora will not merge accounts automatically.'
  if(/429|rate limit|too many|security purposes/i.test(text))
    return 'Too many SMS requests. Wait before trying again.'
  if(/expired|invalid.*(?:token|code|otp)/i.test(text))
    return 'That code is invalid or expired. Request a new code.'
  return text.slice(0,250)||'Could not verify the phone number. Please try again.'
}
