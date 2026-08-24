# Domain glossary

## Booking Request

A guest's request for the property to review a sellable stay before deciding
whether to create a reservation. A Booking Request does not reserve inventory.

## Request Mode

A direct-booking mode in which submitting the guest form creates a Booking
Request instead of a reservation.

## Waitlist Entry

Non-deducting demand recorded when the requested stay is not currently
available. A Waitlist Entry is not a Booking Request.

## Quote Snapshot

The immutable record of the offer shown when a Booking Request was submitted.
Later prices and accepted prices do not rewrite this record.

## Accepted Price

The stay price chosen by staff when accepting a Booking Request. It can match
the Quote Snapshot, the current authoritative quote, or a justified custom
price.

## Payment Plan

A staff-managed set of expected partial payments. A Payment Plan can express
amounts or percentages and due milestones, but never initiates a payment by
itself.

## Payment Movement

An attempted or completed movement of money, either through the configured
card gateway or recorded after taking place outside HAIP.

## Stay Amendment

An audited change to an accepted reservation, such as extending its departure
date. A Stay Amendment does not rewrite the original Booking Request or its
Accepted Price.
