const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/

export function environmentNames(name: string) {
	const normalized = name.toLowerCase()
	if (!NAME_PATTERN.test(normalized))
		throw new Error(`Invalid customer name: ${JSON.stringify(name)}`)
	const identifier = normalized.replaceAll('-', '_')
	return {
		name: normalized,
		databaseName: `cust_${identifier}`,
		ownerRole: `cust_${identifier}_owner`,
		stackName: `customer-${normalized}`
	}
}
