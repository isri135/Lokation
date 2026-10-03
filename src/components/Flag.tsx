import { countryByCode } from '../lib/countries'
import { supportsFlagEmoji } from '../lib/flags'

export function Flag({ code }: { code: string }) {
  const flag = countryByCode.get(code)?.flag
  if (supportsFlagEmoji && flag) {
    return (
      <span className="flag" aria-hidden="true">
        {flag}
      </span>
    )
  }
  return (
    <span className="flag-code" aria-hidden="true">
      {code}
    </span>
  )
}
