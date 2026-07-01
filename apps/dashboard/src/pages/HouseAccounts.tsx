import { useState } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, ChevronLeft, Package } from 'lucide-react';
import { api } from '../lib/api';
import { moneyString, requirePropertyId } from '../lib/api-helpers';
import { useProperty } from '../context/PropertyContext';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';

interface HouseAccount {
  id: string;
  name: string;
  kind: string;
  status: string;
  balance?: string | number;
  currencyCode?: string;
}

interface Product {
  id: string;
  name: string;
  category?: string;
  price: string;
  currencyCode: string;
  isActive?: boolean;
}

function HouseAccountList() {
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'accounts' | 'products'>('accounts');
  const [createOpen, setCreateOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('retail');
  const [productName, setProductName] = useState('');
  const [productPrice, setProductPrice] = useState('');
  const [productCategory, setProductCategory] = useState('');

  const { data } = useQuery({
    queryKey: ['house-accounts', propertyId],
    queryFn: () => api.get('/v1/house-accounts', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: productsData } = useQuery({
    queryKey: ['products', propertyId],
    queryFn: () => api.get('/v1/products', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId && tab === 'products',
  });

  const accounts: HouseAccount[] = data?.data ?? data ?? [];
  const products: Product[] = productsData?.data ?? productsData ?? [];

  const createMutation = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post('/v1/house-accounts', { propertyId, name, kind, currencyCode: 'USD' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['house-accounts'] });
      setCreateOpen(false);
      setName('');
    },
  });

  const createProduct = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post('/v1/products', {
        propertyId,
        name: productName,
        price: moneyString(productPrice),
        currencyCode: 'USD',
        category: productCategory || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setProductOpen(false);
      setProductName('');
      setProductPrice('');
      setProductCategory('');
    },
  });

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">Select a property</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Building2 size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">House Accounts</h1>
        <div className="ml-auto flex gap-2">
          {tab === 'accounts' ? (
            <button onClick={() => setCreateOpen(true)} className="flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold">
              <Plus size={16} /> Open Account
            </button>
          ) : (
            <button onClick={() => setProductOpen(true)} className="flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold">
              <Plus size={16} /> Add Product
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1 mb-4 border-b border-gray-200">
        <button onClick={() => setTab('accounts')} className={`px-4 py-2 text-sm font-semibold border-b-2 ${tab === 'accounts' ? 'border-telivity-teal text-telivity-teal' : 'border-transparent text-telivity-mid-grey'}`}>Accounts</button>
        <button onClick={() => setTab('products')} className={`px-4 py-2 text-sm font-semibold border-b-2 ${tab === 'products' ? 'border-telivity-teal text-telivity-teal' : 'border-transparent text-telivity-mid-grey'}`}>Products</button>
      </div>

      {tab === 'accounts' ? (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-telivity-teal/5 border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Kind</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">Balance</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a, i) => (
                <tr key={a.id} onClick={() => navigate(`/house-accounts/${a.id}`)} className={`border-b border-gray-50 cursor-pointer hover:bg-telivity-light-grey/50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                  <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{a.name}</td>
                  <td className="px-4 py-3 text-sm text-telivity-slate">{a.kind}</td>
                  <td className="px-4 py-3"><StatusBadge status={a.status === 'open' ? 'success' : 'completed'} label={a.status} /></td>
                  <td className="px-4 py-3 text-sm text-right font-medium">${Number(a.balance ?? 0).toFixed(2)}</td>
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">No house accounts</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-telivity-teal/5 border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Category</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">Price</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, i) => (
                <tr key={p.id} className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                  <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{p.name}</td>
                  <td className="px-4 py-3 text-sm text-telivity-slate">{p.category ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-right">${Number(p.price).toFixed(2)} {p.currencyCode}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.isActive !== false ? 'success' : 'completed'} label={p.isActive !== false ? 'Active' : 'Inactive'} /></td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">No products</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Open House Account">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Kind</label>
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="retail">Retail</option>
              <option value="vendor">Vendor</option>
              <option value="internal">Internal</option>
              <option value="other">Other</option>
            </select>
          </div>
          <button onClick={() => createMutation.mutate()} disabled={!name || createMutation.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Open</button>
        </div>
      </Modal>

      <Modal open={productOpen} onClose={() => setProductOpen(false)} title="Add Product">
        <div className="space-y-4">
          <input type="text" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Product name *" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <input type="text" value={productCategory} onChange={(e) => setProductCategory(e.target.value)} placeholder="Category" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <input type="number" step="0.01" value={productPrice} onChange={(e) => setProductPrice(e.target.value)} placeholder="Price *" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <button onClick={() => createProduct.mutate()} disabled={!productName || !productPrice || createProduct.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Create</button>
        </div>
      </Modal>
    </div>
  );
}

function HouseAccountDetail() {
  const { id } = useParams<{ id: string }>();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [chargeOpen, setChargeOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [chargeDesc, setChargeDesc] = useState('');
  const [chargeAmount, setChargeAmount] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [sellQty, setSellQty] = useState('1');

  const { data } = useQuery({
    queryKey: ['house-accounts', id, propertyId],
    queryFn: () => api.get(`/v1/house-accounts/${id}`, { params: { propertyId } }).then((r) => r.data),
    enabled: !!id && !!propertyId,
  });

  const { data: productsData } = useQuery({
    queryKey: ['products', propertyId],
    queryFn: () => api.get('/v1/products', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const account: HouseAccount | null = data?.data ?? data ?? null;
  const products: Product[] = productsData?.data ?? productsData ?? [];
  const currencyCode = account?.currencyCode ?? 'USD';

  const postCharge = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post(`/v1/house-accounts/${id}/charges`, {
        propertyId,
        description: chargeDesc,
        amount: moneyString(chargeAmount),
        currencyCode,
      }, { params: { propertyId } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['house-accounts'] });
      setChargeOpen(false);
      setChargeAmount('');
      setChargeDesc('');
    },
  });

  const postPayment = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post(`/v1/house-accounts/${id}/payments`, {
        propertyId,
        method: paymentMethod,
        amount: moneyString(paymentAmount),
        currencyCode,
      }, { params: { propertyId } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['house-accounts'] });
      setPaymentOpen(false);
      setPaymentAmount('');
    },
  });

  const sellProduct = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post(`/v1/house-accounts/${id}/sell`, {
        propertyId,
        productId: selectedProductId,
        quantity: Number(sellQty) || 1,
      }, { params: { propertyId } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['house-accounts'] });
      setSellOpen(false);
      setSelectedProductId('');
      setSellQty('1');
    },
  });

  const closeAccount = useMutation({
    mutationFn: () => api.post(`/v1/house-accounts/${id}/close`, {}, { params: { propertyId } }),
    onSuccess: () => navigate('/house-accounts'),
  });

  if (!account) return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">Loading...</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/house-accounts')} className="p-1.5 rounded hover:bg-telivity-light-grey"><ChevronLeft size={20} /></button>
        <Building2 size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{account.name}</h1>
        <StatusBadge status={account.status === 'open' ? 'success' : 'completed'} label={account.status} />
        <div className="ml-auto text-right">
          <p className="text-xs text-telivity-mid-grey">Balance</p>
          <p className="text-xl font-semibold">${Number(account.balance ?? 0).toFixed(2)}</p>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        {account.status === 'open' && (
          <>
            <button onClick={() => setChargeOpen(true)} className="bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold">Post Charge</button>
            <button onClick={() => setPaymentOpen(true)} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-semibold">Record Payment</button>
            <button onClick={() => setSellOpen(true)} className="flex items-center gap-1 border border-gray-200 rounded-lg px-4 py-2 text-sm font-semibold"><Package size={14} /> Sell Product</button>
            <button onClick={() => closeAccount.mutate()} disabled={closeAccount.isPending} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-semibold">Close Account</button>
          </>
        )}
      </div>

      <Modal open={chargeOpen} onClose={() => setChargeOpen(false)} title="Post Charge">
        <div className="space-y-4">
          <input type="text" value={chargeDesc} onChange={(e) => setChargeDesc(e.target.value)} placeholder="Description" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <input type="number" step="0.01" value={chargeAmount} onChange={(e) => setChargeAmount(e.target.value)} placeholder="Amount" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <button onClick={() => postCharge.mutate()} disabled={!chargeAmount || !chargeDesc || postCharge.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Post</button>
        </div>
      </Modal>

      <Modal open={paymentOpen} onClose={() => setPaymentOpen(false)} title="Record Payment">
        <div className="space-y-4">
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
            <option value="cash">Cash</option>
            <option value="credit_card">Credit Card</option>
            <option value="debit_card">Debit Card</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="other">Other</option>
          </select>
          <input type="number" step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} placeholder="Amount" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <button onClick={() => postPayment.mutate()} disabled={!paymentAmount || postPayment.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Record</button>
        </div>
      </Modal>

      <Modal open={sellOpen} onClose={() => setSellOpen(false)} title="Sell Product">
        <div className="space-y-4">
          <select value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
            <option value="">Select product</option>
            {products.filter((p) => p.isActive !== false).map((p) => (
              <option key={p.id} value={p.id}>{p.name} — ${Number(p.price).toFixed(2)}</option>
            ))}
          </select>
          <input type="number" min="1" value={sellQty} onChange={(e) => setSellQty(e.target.value)} placeholder="Quantity" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <button onClick={() => sellProduct.mutate()} disabled={!selectedProductId || sellProduct.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Sell</button>
        </div>
      </Modal>
    </div>
  );
}

export default function HouseAccounts() {
  return (
    <Routes>
      <Route index element={<HouseAccountList />} />
      <Route path=":id" element={<HouseAccountDetail />} />
    </Routes>
  );
}
