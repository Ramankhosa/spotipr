'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import Link from 'next/link'

interface Project {
  id: string
  name: string
  createdAt: string
  applicantProfile?: {
    id: string
    applicantLegalName: string
  }
  collaborators?: {
    id: string
    role: string
    user: {
      id: string
      name: string | null
      email: string
    }
  }[]
}

interface DropdownState {
  [projectId: string]: boolean
}

export default function UserDashboard() {
  const { user, logout } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [editingProjectName, setEditingProjectName] = useState('')
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState<DropdownState>({})

  // Load projects on component mount
  useEffect(() => {
    if (user) {
      fetchProjects()
    }
  }, [user])

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element
      if (!target.closest('.dropdown-container')) {
        closeAllDropdowns()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })
      if (response.ok) {
        const data = await response.json()
        setProjects(data.projects || [])
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!projectName.trim()) return

    setIsCreating(true)
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ name: projectName.trim() })
      })

      if (response.ok) {
        const data = await response.json()
        resetCreateForm()
        // Could redirect to the new project, but for now just refresh
        fetchProjects()
      } else {
        const errorText = await response.text()
        console.error('Failed to create project:', response.status, errorText)
        alert('Failed to create project')
      }
    } catch (error) {
      console.error('Failed to create project:', error)
      alert('Failed to create project')
    } finally {
      setIsCreating(false)
    }
  }

  const handleEditProject = async (projectId: string, newName: string) => {
    if (!newName.trim()) return

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ name: newName.trim() })
      })

      if (response.ok) {
        const updatedProject = await response.json()
        setProjects(projects.map(p => p.id === projectId ? updatedProject.project : p))
        setEditingProjectId(null)
        setEditingProjectName('')
      } else {
        console.error('Failed to update project')
        alert('Failed to update project')
      }
    } catch (error) {
      console.error('Failed to update project:', error)
      alert('Failed to update project')
    }
  }

  const handleDeleteProject = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        setProjects(projects.filter(p => p.id !== projectId))
        setDeletingProjectId(null)
      } else {
        console.error('Failed to delete project')
        alert('Failed to delete project')
      }
    } catch (error) {
      console.error('Failed to delete project:', error)
      alert('Failed to delete project')
    }
  }

  const startEditing = (project: Project) => {
    setEditingProjectId(project.id)
    setEditingProjectName(project.name)
  }

  const cancelEditing = () => {
    setEditingProjectId(null)
    setEditingProjectName('')
  }

  const toggleDropdown = (projectId: string) => {
    setDropdownOpen(prev => ({
      ...prev,
      [projectId]: !prev[projectId]
    }))
  }

  const closeAllDropdowns = () => {
    setDropdownOpen({})
  }

  const resetCreateForm = () => {
    setProjectName('')
    setShowCreateForm(false)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
              <p className="text-gray-600">Welcome to your workspace</p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <div className="text-sm text-gray-500">{user?.email}</div>
                <div className="text-xs text-gray-400">Role: {user?.role}</div>
                {user?.ati_id && (
                  <div className="text-xs text-gray-400">Company: {user?.ati_id}</div>
                )}
              </div>
              <button
                onClick={logout}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {/* Welcome Section */}
        <div className="bg-white shadow rounded-lg mb-8">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-2">
              Welcome, {user?.email?.split('@')[0]}!
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              You are logged in with <span className="font-medium">{user?.role}</span> permissions
              {user?.ati_id && (
                <span> for company <span className="font-medium">{user?.ati_id}</span></span>
              )}.
            </p>
            {(user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER' || user?.role === 'ANALYST') && (
              <div className="border-t border-gray-200 pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-medium text-gray-900">Ready to draft a patent?</h4>
                    <p className="text-sm text-gray-600">Start the AI-powered patent drafting workflow</p>
                  </div>
                  <Link
                    href="/patents/draft/new"
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all duration-200"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    Start Patent Draft
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Create Project Section */}
        {(user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER' || user?.role === 'ANALYST') && (
          <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Create New Project</h2>
              <button
                onClick={() => setShowCreateForm(!showCreateForm)}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all duration-200"
              >
                {showCreateForm ? 'Cancel' : '+ New Project'}
              </button>
            </div>

            {showCreateForm && (
              <form onSubmit={handleCreateProject} className="space-y-4">
                <div>
                  <label htmlFor="projectName" className="block text-sm font-medium text-gray-700 mb-1">
                    Project Name
                  </label>
                  <input
                    id="projectName"
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="Enter project name"
                    className="appearance-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                    required
                  />
                </div>

                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={resetCreateForm}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-all duration-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCreating}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                  >
                    {isCreating ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Creating...
                      </>
                    ) : (
                      'Create Project'
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Projects List */}
        <div className="bg-white rounded-lg shadow-sm overflow-visible">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Your Projects</h2>
          </div>

          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
              <p className="mt-2 text-sm text-gray-500">Loading projects...</p>
            </div>
          ) : projects.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <div className="text-gray-500 mb-4">
                <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No projects yet</h3>
              <p className="text-gray-600 mb-4">
                Create your first project to get started with patent filings.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {projects.map((project) => (
                <div key={project.id} className="px-6 py-4 hover:bg-gray-50 transition-colors duration-150">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      {editingProjectId === project.id ? (
                        <div className="flex items-center space-x-2">
                          <input
                            type="text"
                            value={editingProjectName}
                            onChange={(e) => setEditingProjectName(e.target.value)}
                            className="text-lg font-medium text-gray-900 border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleEditProject(project.id, editingProjectName)
                              } else if (e.key === 'Escape') {
                                cancelEditing()
                              }
                            }}
                          />
                          <button
                            onClick={() => handleEditProject(project.id, editingProjectName)}
                            className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelEditing}
                            className="text-gray-500 hover:text-gray-700 text-sm font-medium"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <h3 className="text-lg font-medium text-gray-900">{project.name}</h3>
                      )}
                      {project.applicantProfile && (
                        <p className="text-sm text-gray-600 mt-1">
                          Applicant: {project.applicantProfile.applicantLegalName}
                        </p>
                      )}
                      {project.collaborators && project.collaborators.length > 0 && (
                        <p className="text-sm text-gray-600 mt-1">
                          Collaborators: {project.collaborators.length}
                        </p>
                      )}
                      <p className="text-sm text-gray-500 mt-1">
                        Created {new Date(project.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Link
                        href={`/projects/${project.id}`}
                        className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all duration-200"
                      >
                        Open
                      </Link>
                      {(user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER' || user?.role === 'ANALYST') && (
                        <Link
                          href={`/projects/${project.id}/patents/new`}
                          className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-all duration-200"
                        >
                          Add Patent
                        </Link>
                      )}

                      {/* Dropdown Menu */}
                      <div className="relative dropdown-container">
                        <button
                          onClick={() => toggleDropdown(project.id)}
                          className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all duration-200"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                          </svg>
                        </button>

                        {dropdownOpen[project.id] && (
                          <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 z-50">
                            <div className="py-1">
                              <button
                                onClick={() => {
                                  startEditing(project)
                                  closeAllDropdowns()
                                }}
                                className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                              >
                                Edit Title
                              </button>
                              <Link
                                href={`/projects/${project.id}/setup`}
                                className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                              >
                                Manage Team
                              </Link>
                              <div className="border-t border-gray-100"></div>
                              <button
                                onClick={() => {
                                  setDeletingProjectId(project.id)
                                  closeAllDropdowns()
                                }}
                                className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 hover:text-red-700"
                              >
                                Delete Project
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Delete Confirmation Modal */}
                  {deletingProjectId === project.id && (
                    <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-sm text-red-800 mb-3">
                        Are you sure you want to delete "{project.name}"? This action cannot be undone.
                      </p>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleDeleteProject(project.id)}
                          className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                        >
                          Delete Project
                        </button>
                        <button
                          onClick={() => setDeletingProjectId(null)}
                          className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
