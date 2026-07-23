import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Search } from './pages/Search';
import { Results } from './pages/Results';
import { RoomSelect } from './pages/RoomSelect';
import { Extras } from './pages/Extras';
import { GuestDetails } from './pages/GuestDetails';
import { Payment } from './pages/Payment';
import { Confirmation } from './pages/Confirmation';
import { ManageBooking } from './pages/ManageBooking';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Search />} />
        <Route path="/results" element={<Results />} />
        <Route path="/room" element={<RoomSelect />} />
        <Route path="/extras" element={<Extras />} />
        <Route path="/guest" element={<GuestDetails />} />
        <Route path="/payment" element={<Payment />} />
        <Route path="/confirmation" element={<Confirmation />} />
        <Route path="/manage" element={<ManageBooking />} />
        <Route path="*" element={<Search />} />
      </Routes>
    </Layout>
  );
}
