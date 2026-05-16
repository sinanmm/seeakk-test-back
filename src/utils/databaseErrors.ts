export const isPrismaSchemaMismatchError = (error: any): boolean => 
  error?.code === 'P2021' || error?.code === 'P2022';

export const isTransientDatabaseError = (error: any): boolean => {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return (
    code === 'P1001' ||
    code === 'P1017' ||
    code === 'P2024' ||
    message.includes('error in postgresql connection') ||
    message.includes('connection terminated unexpectedly') ||
    message.includes('server closed the connection unexpectedly') ||
    message.includes('can not perform operation: connection is closed') ||
    message.includes('connection is closed')
  );
};
