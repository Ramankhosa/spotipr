# Spotipr - AI-Powered Grant Writing

A modern, professional authentication system built with Next.js, featuring ChatGPT-inspired UI/UX design.

## Features

- **Modern Authentication**: Registration and login with secure password hashing
- **ChatGPT-Style UI**: Clean, minimalistic design inspired by ChatGPT
- **Forgot Password**: Email-based password reset using SendGrid API
- **Database Integration**: PostgreSQL with Prisma ORM
- **Type Safety**: Full TypeScript support
- **Responsive Design**: Mobile-friendly interface

## Tech Stack

- **Frontend**: Next.js 14, React 18, TypeScript
- **Styling**: Tailwind CSS with custom ChatGPT-inspired theme
- **Authentication**: NextAuth.js with credentials provider
- **Database**: PostgreSQL with Prisma ORM
- **Email**: SendGrid API for password reset emails
- **Validation**: Zod for input validation

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database
- SendGrid account for email functionality

### Installation

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   Create a `.env.local` file in the root directory:
   ```env
   # Database and Auth
   DATABASE_URL=postgresql://postgres:123@localhost:5432/spotipr
   NEXTAUTH_URL=http://localhost:3000/
   NEXTAUTH_SECRET=your-secret-key-change-in-production

   # External Access
   NEXT_PUBLIC_TINYMCE_API_KEY=your-tinymce-api-key
   SENDGRID_API_KEY=your-sendgrid-api-key
   ```

3. **Set up the database:**
   ```bash
   npx prisma generate
   npx prisma db push
   ```

4. **Run the development server:**
   ```bash
   npm run dev
   ```

5. **Open your browser:**
   Navigate to [http://localhost:3000](http://localhost:3000)

## Project Structure

```
src/
├── app/                    # Next.js app router pages
│   ├── layout.tsx         # Root layout with SessionProvider
│   ├── page.tsx           # Home page (protected)
│   ├── login/             # Login page
│   ├── register/          # Registration page
│   └── globals.css        # Global styles and animations
├── lib/                   # Utility libraries
│   ├── prisma.ts          # Database client
│   ├── auth.ts            # Password hashing and email utilities
│   └── auth-config.ts     # NextAuth configuration
├── components/            # Reusable React components
└── pages/api/             # API routes
    └── auth/              # Authentication endpoints
        ├── [...nextauth].ts
        ├── register.ts
        └── forgot-password.ts
```

## Authentication Flow

1. **Registration**: Users can create accounts with email, password, and name
2. **Login**: Secure authentication using NextAuth.js credentials provider
3. **Forgot Password**: Users receive reset emails via SendGrid
4. **Session Management**: JWT-based sessions with secure cookies

## API Endpoints

- `POST /api/auth/register` - User registration
- `POST /api/auth/forgot-password` - Password reset request
- `GET/POST /api/auth/[...nextauth]` - NextAuth.js endpoints

## UI/UX Design

The application features a ChatGPT-inspired design with:

- Clean, minimalistic interface
- Smooth animations and transitions
- Consistent color palette (blues and grays)
- Responsive layout for all devices
- Loading states and error handling
- Accessible form controls

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

### Database Management

```bash
# Generate Prisma client
npx prisma generate

# Push schema changes
npx prisma db push

# View database
npx prisma studio
```

## Security Features

- Password hashing with bcrypt
- JWT-based authentication
- Input validation with Zod
- SQL injection prevention via Prisma
- Secure cookie handling
- Rate limiting considerations (can be added)

## Deployment

1. Set up production database (PostgreSQL)
2. Configure environment variables
3. Update `NEXTAUTH_URL` to your domain
4. Generate secure `NEXTAUTH_SECRET`
5. Deploy to Vercel, Netlify, or your preferred platform

## Contributing

1. Follow the existing code style and patterns
2. Add TypeScript types for all new code
3. Test authentication flows thoroughly
4. Maintain the ChatGPT-inspired UI consistency

## License

This project is licensed under the MIT License.

