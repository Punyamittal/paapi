export interface AddressComponents {
  street?: string;
  locality?: string;
  city?: string;
  district?: string;
  state?: string;
  pincode?: string;
  country?: string;
}

const INDIAN_STATES = new Set([
  'andhra pradesh', 'arunachal pradesh', 'assam', 'bihar', 'chhattisgarh', 'goa',
  'gujarat', 'haryana', 'himachal pradesh', 'jharkhand', 'karnataka', 'kerala',
  'madhya pradesh', 'maharashtra', 'manipur', 'meghalaya', 'mizoram', 'nagaland',
  'odisha', 'punjab', 'rajasthan', 'sikkim', 'tamil nadu', 'telangana', 'tripura',
  'uttar pradesh', 'uttarakhand', 'west bengal', 'delhi', 'nct of delhi',
  'jammu and kashmir', 'ladakh', 'puducherry', 'chandigarh',
]);

function cleanPart(part: string): string {
  return part.replace(/\s+/g, ' ').trim();
}

function isStateName(part: string): boolean {
  return INDIAN_STATES.has(part.toLowerCase());
}

/** Parse Indian/international addresses into city, locality, state, pincode, etc. */
export function parseAddress(address: string): AddressComponents {
  const raw = address.replace(/\s+/g, ' ').trim();
  if (!raw) return {};

  const pincodeMatch = raw.match(/\b(\d{6})\b/);
  const pincode = pincodeMatch?.[1];

  let working = raw;
  if (pincode) {
    working = working.replace(new RegExp(`\\b${pincode}\\b`), ' ').replace(/\s+/g, ' ').trim();
  }

  const parts = working
    .split(/[,;\n|]+/)
    .map(cleanPart)
    .filter((part) => part.length > 1);

  const result: AddressComponents = { pincode };

  if (parts.length === 0) {
    return result;
  }

  let stateIndex = -1;
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (isStateName(parts[i])) {
      result.state = parts[i];
      stateIndex = i;
      break;
    }
  }

  const remaining = stateIndex >= 0
    ? parts.filter((_, index) => index !== stateIndex)
    : [...parts];

  if (remaining.length >= 1) {
    const last = remaining[remaining.length - 1];
    if (!result.state && isStateName(last)) {
      result.state = last;
      remaining.pop();
    } else if (remaining.length >= 2) {
      result.city = last;
      remaining.pop();
    } else {
      result.city = last;
      remaining.pop();
    }
  }

  if (remaining.length >= 1) {
    result.locality = remaining[remaining.length - 1];
    remaining.pop();
  }

  if (remaining.length >= 1) {
    result.street = remaining.join(', ');
  }

  if (!result.state && result.city && isStateName(result.city)) {
    result.state = result.city;
    result.city = result.locality;
    result.locality = result.street;
    delete result.street;
  }

  if (/india/i.test(raw) && !result.country) {
    result.country = 'India';
  }

  return result;
}

export function addressComponentsToFields(
  components: AddressComponents,
): Array<{ key: string; label: string; value: string }> {
  const entries: Array<{ key: string; label: string; value: string }> = [];
  const push = (key: string, label: string, value?: string) => {
    if (value?.trim()) entries.push({ key, label, value: value.trim() });
  };

  push('street', 'Street / House No.', components.street);
  push('locality', 'Locality / Area', components.locality);
  push('city', 'City', components.city);
  push('district', 'District', components.district);
  push('state', 'State', components.state);
  push('pincode', 'Pincode / ZIP', components.pincode);
  push('country', 'Country', components.country);

  return entries;
}

export function enrichFieldsFromAddress(
  existingKeys: Set<string>,
  addressValue: string,
): Array<{ key: string; label: string; value: string }> {
  const parsed = parseAddress(addressValue);
  return addressComponentsToFields(parsed).filter((field) => !existingKeys.has(field.key));
}
